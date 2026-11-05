// Tool-selection lint, #362 Layer A: free, deterministic checks over the tool catalog (the exact
// tools/list a client sees) for what makes a model pick the wrong tool or the wrong args —
// confusable descriptions, required args the model can't learn about, destructive writes that
// don't say they preview first — plus EN+RU trigger coverage of the skill manual.

/** The slice of a tools/list entry the lint reads (docs/tool-catalog.json shape). */
export interface CatalogTool {
  name: string;
  description: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown };
  inputSchema: {
    properties?: Record<string, { description?: string; [k: string]: unknown }>;
    required?: string[];
    [k: string]: unknown;
  };
  _meta?: { ui?: { visibility?: string[] }; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * One finding; `tools` is empty for skill-level rules, `arg` names an undocumented arg, `score`
 * is the pair's overlap for the two overlap rules.
 */
export interface Violation {
  rule: "description-overlap" | "lead-overlap" | "preview-first" | "undocumented-arg" | "triggers-en" | "triggers-ru";
  tools: string[];
  arg?: string;
  score?: number;
}

/** Pairwise word overlap (Jaccard) of two tools' whole descriptions and of their lead sentences. */
export interface OverlapScore {
  a: string;
  b: string;
  full: number;
  lead: number;
}

// Basis: the worst pair on the 2026-11-05 catalog scores 0.21 (find_duplicates/quality_report);
// a copied description scores 1.0. 0.35 leaves room for honest growth and still trips well short
// of "half the words shared".
export const MAX_DESCRIPTION_OVERLAP = 0.35;
// Basis: the lead sentence is what a model matches a request against; today's worst pair is 0.28
// (quality_report/recover_metadata, both "metadata" scans), so 0.45 flags a lead that mostly repeats another.
export const MAX_LEAD_OVERLAP = 0.45;
// Basis: the skill manual lists its triggers in English and Ukrainian/Russian (Artem's libraries
// are EN + RU); one trigger per script is the floor that keeps either language reachable.
export const MIN_TRIGGERS_PER_SCRIPT = 1;

// Function words, plus words every tool here shares (they say nothing about which tool to pick).
const STOP = new Set(
  (
    "the a an and or of to in on for by with from as at is are be it its this that via any all one each " +
    "set use used using when then than not only into per also can more etc book books library libraries calibre"
  ).split(" "),
);
// Params whose presence in the description shows how to go from preview to apply.
const APPLY_PARAMS = ["confirm", "preview", "apply"];

/** App-only (widget-internal) tools: hosts hide them from the model, so they can't confuse it. */
function modelFacing(t: CatalogTool): boolean {
  const vis = t._meta?.ui?.visibility;
  return !vis || vis.includes("model");
}

/** The tools the lint checks: every tool the model sees. */
export function modelFacingTools(tools: readonly CatalogTool[]): CatalogTool[] {
  return tools.filter(modelFacing);
}

/** Content words: tool-name cross-references removed, lowercased, crude plural fold. */
function words(text: string): Set<string> {
  return new Set(
    text
      .replace(/calibre_\w+/g, " ")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => w.replace(/(?<=..)s$/, "")),
  );
}

/** The first sentence ("e.g." is not a sentence end). */
function lead(text: string): string {
  return text.split(/(?<!e\.g)\.\s/)[0] ?? text;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

const mentions = (text: string, word: string): boolean => new RegExp(`\\b${word}\\b`).test(text);
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The arg is named AS a parameter (`name`, name=, or (name)), so a prose coincidence ("Calibre
 * query syntax", "at query time") doesn't count as documenting a required `query`.
 */
function namesParam(text: string, arg: string): boolean {
  const a = escape(arg);
  return new RegExp(`\`${a}\`|\\b${a}=|\\(${a}\\)`).test(text);
}

/** Overlap scores for every pair of model-facing tools, in catalog order. */
export function overlapScores(tools: readonly CatalogTool[]): OverlapScore[] {
  const visible = tools.filter(modelFacing);
  const out: OverlapScore[] = [];
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i]!;
      const b = visible[j]!;
      out.push({
        a: a.name,
        b: b.name,
        full: jaccard(words(a.description), words(b.description)),
        lead: jaccard(words(lead(a.description)), words(lead(b.description))),
      });
    }
  }
  return out;
}

/** All catalog violations: overlap pairs first (catalog order), then per-tool rules. */
export function lintCatalog(tools: readonly CatalogTool[]): Violation[] {
  const out: Violation[] = [];
  for (const s of overlapScores(tools)) {
    if (s.full >= MAX_DESCRIPTION_OVERLAP) out.push({ rule: "description-overlap", tools: [s.a, s.b], score: s.full });
    if (s.lead >= MAX_LEAD_OVERLAP) out.push({ rule: "lead-overlap", tools: [s.a, s.b], score: s.lead });
  }
  for (const t of tools.filter(modelFacing)) {
    const props = t.inputSchema.properties ?? {};
    // A destructive write must say it previews first AND name the param that applies (D-003).
    // MCP's hint defaults (readOnlyHint false, destructiveHint true): a write tool that sets no
    // hints is treated as destructive, never skipped.
    const readOnly = t.annotations?.readOnlyHint ?? false;
    const destructive = t.annotations?.destructiveHint ?? true;
    if (!readOnly && destructive) {
      const says = /\b(preview|dry-run)/i.test(t.description);
      const names = APPLY_PARAMS.some((p) => p in props && mentions(t.description, p));
      if (!says || !names) out.push({ rule: "preview-first", tools: [t.name] });
    }
    // A required arg the model can't learn about from the description or the schema.
    for (const arg of t.inputSchema.required ?? []) {
      if (!props[arg]?.description && !namesParam(t.description, arg)) {
        out.push({ rule: "undocumented-arg", tools: [t.name], arg });
      }
    }
  }
  return out;
}

/** EN + RU trigger coverage of a skill description's `Triggers on '…', '…'` list. */
export function lintSkillTriggers(description: string): Violation[] {
  const list = /Triggers on (.*)$/s.exec(description)?.[1] ?? "";
  const triggers = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  const cyrillic = triggers.filter((t) => /\p{Script=Cyrillic}/u.test(t)).length;
  const latin = triggers.filter((t) => /\p{Script=Latin}/u.test(t)).length;
  const out: Violation[] = [];
  if (latin < MIN_TRIGGERS_PER_SCRIPT) out.push({ rule: "triggers-en", tools: [] });
  if (cyrillic < MIN_TRIGGERS_PER_SCRIPT) out.push({ rule: "triggers-ru", tools: [] });
  return out;
}

/** One line per finding saying how to fix it — the assertion message when the lint fails. */
export function hint(v: Violation): string {
  const [a, b] = v.tools;
  const score = v.score?.toFixed(2);
  switch (v.rule) {
    case "description-overlap":
      return `make the descriptions of ${a} and ${b} distinguishable: overlap ${score} ≥ ${MAX_DESCRIPTION_OVERLAP}`;
    case "lead-overlap":
      return `reword the first sentence of ${a} or ${b}: lead overlap ${score} ≥ ${MAX_LEAD_OVERLAP}`;
    case "preview-first":
      return `${a} is a destructive write: say it previews first (preview/dry-run) and name its confirm/preview/apply param`;
    case "undocumented-arg":
      return `${a}: name the required arg as \`${v.arg}\`, ${v.arg}= or (${v.arg}) in the description, or give it a schema description`;
    case "triggers-en":
      return `add at least ${MIN_TRIGGERS_PER_SCRIPT} English trigger to the skill's "Triggers on '…'" list`;
    case "triggers-ru":
      return `add at least ${MIN_TRIGGERS_PER_SCRIPT} Cyrillic (RU/UK) trigger to the skill's "Triggers on '…'" list`;
  }
}
