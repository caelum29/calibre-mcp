// #362 Layer A: deterministic tool-selection lint over the tool catalog, run in `pnpm test`.
// A fixture catalog with two confusable descriptions, a destructive write tool without
// preview-first wording and an undocumented required arg must produce exactly those violations;
// the shipped catalog (docs/tool-catalog.json) and the skill's EN+RU triggers must be clean.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CatalogTool,
  lintCatalog,
  lintSkillTriggers,
  MAX_DESCRIPTION_OVERLAP,
  MAX_LEAD_OVERLAP,
  overlapScores,
} from "./catalog-lint.js";
import { hint, modelFacingTools } from "./catalog-lint.js";

const write = { readOnlyHint: false, destructiveHint: true };
const read = { readOnlyHint: true };
const schema = (props: string[], required: string[] = []) => ({
  type: "object",
  properties: Object.fromEntries(props.map((p) => [p, { type: "string" }])),
  ...(required.length ? { required } : {}),
});

const FIXTURE: CatalogTool[] = [
  {
    name: "fx_find",
    description: "Find books by exact title, author or ISBN (query) in the library catalog. Returns matching book ids.",
    annotations: read,
    inputSchema: schema(["query"], ["query"]),
  },
  {
    // a near copy of fx_find: a model can't tell which one to pick
    name: "fx_lookup",
    description: "Find books by title, author or ISBN (query) in the library catalog. Returns the matching book ids.",
    annotations: read,
    inputSchema: schema(["query"], ["query"]),
  },
  {
    // destructive write with no preview / dry-run wording and no confirm param named
    name: "fx_purge",
    description: "Permanently purge the given (ids) from the trash folder of the Calibre instance.",
    annotations: write,
    inputSchema: schema(["ids", "confirm"], ["ids"]),
  },
  {
    // required `changes` is neither described in the schema nor named in the description
    name: "fx_retag",
    description: "Replace the tags on one record with a new tag list chosen by the user.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "the record to retag" }, changes: { type: "string" } },
      required: ["id", "changes"],
    },
  },
  {
    // app-only (widget-internal) tools are hidden from the model: never linted
    name: "fx_widget_copy",
    description: "Find books by exact title, author or ISBN in the library catalog. Returns matching book ids.",
    annotations: read,
    inputSchema: schema(["query"], ["query"]),
    _meta: { ui: { visibility: ["app"] } },
  },
];

const realCatalog = JSON.parse(readFileSync("docs/tool-catalog.json", "utf8")) as { tools: CatalogTool[] };
const skillDescription = (/^description:\s*"(.*)"\s*$/m.exec(readFileSync("skills/calibre-mcp/SKILL.md", "utf8")) ?? [
  "",
  "",
])[1]!;

describe("catalog lint on a fixture catalog (#362 Layer A)", () => {
  it("should_report_exactly_the_confusable_pair_the_preview_gap_and_the_undocumented_arg", () => {
    expect(lintCatalog(FIXTURE).map((v) => `${v.rule}: ${v.tools.join(" + ")}${v.arg ? ` (${v.arg})` : ""}`)).toEqual([
      "description-overlap: fx_find + fx_lookup",
      "lead-overlap: fx_find + fx_lookup",
      "preview-first: fx_purge",
      "undocumented-arg: fx_retag (changes)",
    ]);
  });

  it("should_accept_a_destructive_tool_that_says_dry_run_and_names_its_confirm_param", () => {
    const ok: CatalogTool = {
      ...FIXTURE[2]!,
      description:
        "Purge the given (ids) from the trash. Dry-run unless confirm=true; the dry-run lists what would go.",
    };
    expect(lintCatalog([ok])).toEqual([]);
  });

  it("should_count_a_schema_description_as_documenting_a_required_arg", () => {
    const ok: CatalogTool = {
      ...FIXTURE[3]!,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, changes: { type: "object", description: "fields to replace" } },
        required: ["id", "changes"],
      },
    };
    expect(lintCatalog([ok]).filter((v) => v.rule === "undocumented-arg")).toEqual([
      { rule: "undocumented-arg", tools: ["fx_retag"], arg: "id" },
    ]);
  });
});

describe("skill trigger coverage (#362 Layer A)", () => {
  it("should_flag_a_trigger_list_without_cyrillic_triggers", () => {
    expect(lintSkillTriggers("Use for books. Triggers on 'book', 'ebook', 'library'.")).toEqual([
      { rule: "triggers-ru", tools: [] },
    ]);
  });

  it("should_flag_a_description_without_a_trigger_list", () => {
    expect(lintSkillTriggers("Use for books.")).toEqual([
      { rule: "triggers-en", tools: [] },
      { rule: "triggers-ru", tools: [] },
    ]);
  });
});

describe("the shipped catalog passes the lint (#362 Layer A)", () => {
  it("should_have_no_violations_in_docs_tool_catalog_json", () => {
    expect(lintCatalog(realCatalog.tools)).toEqual([]);
  });

  it("should_cover_EN_and_RU_triggers_in_the_calibre_mcp_skill", () => {
    expect(lintSkillTriggers(skillDescription)).toEqual([]);
  });

  it("should_stay_under_both_overlap_thresholds_on_every_pair", () => {
    const worst = overlapScores(realCatalog.tools).reduce(
      (m, s) => ({ full: Math.max(m.full, s.full), lead: Math.max(m.lead, s.lead) }),
      { full: 0, lead: 0 },
    );
    expect([worst.full < MAX_DESCRIPTION_OVERLAP, worst.lead < MAX_LEAD_OVERLAP]).toEqual([true, true]);
  });

  // #407 review round 1: no vacuous pass, prose doesn't document an arg, hint-less writes are
  // linted, and a failure says how to fix each finding.
  describe("catalog lint review round 1 (#362 Layer A)", () => {
    const shipped = JSON.parse(readFileSync("docs/tool-catalog.json", "utf8")) as {
      counts: { modelFacing: number };
      tools: CatalogTool[];
    };

    it("should_lint_every_model_facing_tool_of_the_shipped_catalog", () => {
      expect([modelFacingTools(shipped.tools).length, shipped.counts.modelFacing > 0]).toEqual([
        shipped.counts.modelFacing,
        true,
      ]);
    });

    it("should_pass_the_shipped_catalog_with_a_fix_hint_per_finding_on_failure", () => {
      const found = lintCatalog(shipped.tools);
      expect(found, found.map(hint).join("\n")).toEqual([]);
    });

    const queryTool = (description: string): CatalogTool => ({
      name: "fx_q",
      description,
      annotations: read,
      inputSchema: schema(["query"], ["query"]),
    });

    it("should_not_count_a_prose_coincidence_as_documenting_a_required_arg", () => {
      expect(lintCatalog([queryTool("Search with Calibre query syntax; no model at query time.")])).toEqual([
        { rule: "undocumented-arg", tools: ["fx_q"], arg: "query" },
      ]);
    });

    it("should_accept_the_arg_named_as_backticked_assignment_or_parenthesised", () => {
      const named = ["Search by `query`.", "Search with query=terms.", "Search by words (query)."];
      expect(named.map((d) => lintCatalog([queryTool(d)]))).toEqual([[], [], []]);
    });

    it("should_treat_a_tool_without_hints_as_a_destructive_write", () => {
      const bare: CatalogTool = {
        name: "fx_bare",
        description: "Delete the given ids (ids) right away.",
        inputSchema: schema(["ids", "confirm"], ["ids"]),
      };
      expect(lintCatalog([bare])).toEqual([{ rule: "preview-first", tools: ["fx_bare"] }]);
    });

    it("should_give_a_one_line_fix_hint_for_each_rule", () => {
      expect([
        hint({ rule: "description-overlap", tools: ["a", "b"], score: 0.4123 }),
        hint({ rule: "lead-overlap", tools: ["a", "b"], score: 0.5 }),
        hint({ rule: "preview-first", tools: ["a"] }),
        hint({ rule: "undocumented-arg", tools: ["a"], arg: "path" }),
        hint({ rule: "triggers-ru", tools: [] }),
      ]).toEqual([
        "make the descriptions of a and b distinguishable: overlap 0.41 ≥ 0.35",
        "reword the first sentence of a or b: lead overlap 0.50 ≥ 0.45",
        "a is a destructive write: say it previews first (preview/dry-run) and name its confirm/preview/apply param",
        "a: name the required arg as `path`, path= or (path) in the description, or give it a schema description",
        "add at least 1 Cyrillic (RU/UK) trigger to the skill's \"Triggers on '…'\" list",
      ]);
    });
  });
});
