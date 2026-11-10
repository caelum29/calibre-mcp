// Labelled lines: `Label: value` lines in a tool result's text channel that a model reads as
// fields. Error results are text-only on both clients (#437), so their code and next step ride here.
// One home for the label strings so the public-contract registry (#454) can list them.

/** Labels of the lines toolError appends to every error text. */
export const ERROR_LINE_LABELS = {
  code: "Code",
  next: "Next",
} as const;

/** Render one labelled line: `Label: value`. */
export function labelledLine(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** Labels of calibre_ping's report lines that carry a declared structured field. */
export const PING_LINE_LABELS = {
  /** Calibre's own write gate (`calibreWriteAccess`, #439), next to our `writes:` gate line. */
  calibreWrites: "calibre writes",
  /** Per-library index coverage (`indexes[]`, #440): `Name (id: Lib_Id) [default]: <state>` entries. */
  index: "Index",
  /** Semantic-search readiness + the resolved library's counts (`semantic`, #440); built in semantic/status.ts. */
  semanticSearch: "Semantic search",
} as const;
