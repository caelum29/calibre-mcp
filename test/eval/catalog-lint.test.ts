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
    description: "Find books by exact title, author or ISBN query in the library catalog. Returns matching book ids.",
    annotations: read,
    inputSchema: schema(["query"], ["query"]),
  },
  {
    // a near copy of fx_find: a model can't tell which one to pick
    name: "fx_lookup",
    description: "Find books by title, author or ISBN query in the library catalog. Returns the matching book ids.",
    annotations: read,
    inputSchema: schema(["query"], ["query"]),
  },
  {
    // destructive write with no preview / dry-run wording and no confirm param named
    name: "fx_purge",
    description: "Permanently purge the given ids from the trash folder of the Calibre instance.",
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
      description: "Purge the given ids from the trash. Dry-run unless confirm=true; the dry-run lists what would go.",
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
});
