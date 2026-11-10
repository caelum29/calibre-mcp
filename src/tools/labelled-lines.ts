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
  /** The running Calibre's version (`calibreVersion`, #499): `9.18`, `9.18.1` or `unknown`. */
  calibreVersion: "calibre version",
  /** Per-library index coverage (`indexes[]`, #440): `Name (id: Lib_Id) [default]: <state>` entries. */
  index: "Index",
  /** Semantic-search readiness + the resolved library's counts (`semantic`, #440); built in semantic/status.ts. */
  semanticSearch: "Semantic search",
} as const;

// ── The 1.0 registry (#454) ──────────────────────────────────────────────────────────────────
// The text half of the public contract (#448): per tool, every Labelled line — a text line whose
// label + value format carry a declared output field — and nothing else. Prose around them stays
// free. Labels are written here as literals, not from the constants above: this table is the
// frozen statement and the renderers must match it (test/tools/channel-parity.test.ts checks
// both; the docs table in docs/TOOLS.md is generated from it and is the reviewable snapshot).

/** One Labelled line (or the Labelled part of a mixed line). */
export interface LabelledLine {
  /** The label as printed. */
  label: string;
  /**
   * Where it sits: a whole `line`, the `tail` of a line whose start is Prose, or a repeated
   * `segment` inside a line (one per item).
   */
  match: "line" | "tail" | "segment";
  /** Pattern of the contract part; the named group `v` is the value. */
  pattern: RegExp;
  /** Value format, as users read it in docs/TOOLS.md. */
  format: string;
  /** The structured field the value mirrors (`a.b`, `a[].b` for each item). */
  field: string;
  /**
   * How the test ties the value to the field: `equal` (same string/number per occurrence, in
   * order), `join` (the array joined with ", "), `length` (array length), `format` (pattern only).
   */
  compare: "equal" | "join" | "length" | "format";
  /** What part of the line is contract when the rest is Prose. */
  note?: string;
}

/** A tool's entry: its Labelled lines, or why its text is all Prose. */
export type ToolLabelledLines = { lines: LabelledLine[] } | { none: string };

/** On every tool's error results (#437). */
export const ERROR_LINES: readonly LabelledLine[] = [
  {
    label: "Code",
    match: "line",
    pattern: /^Code: (?<v>[a-z_]+)$/,
    format: "`Code: <errorCode>` — one of the closed error-code set",
    field: "errorCode",
    compare: "equal",
  },
  {
    label: "Next",
    match: "line",
    pattern: /^Next: (?<v>.+)$/,
    format: "`Next: <hint>` — omitted when the message already states the hint",
    field: "hint",
    compare: "equal",
    note: "the hint text itself is Prose; the label and its presence are contract",
  },
];

/** The next-page cursor every paginated tool prints (#211). */
const CURSOR_LINE: LabelledLine = {
  label: "cursor",
  match: "tail",
  pattern: /cursor: (?<v>\S+)$/,
  format: "`… cursor: <nextCursor>` at the end of the line — pass the token verbatim",
  field: "nextCursor",
  compare: "equal",
  note: "the words before `cursor:` are Prose",
};

// channel-parity still pins these tools' field VALUES in the text; only the wording is free
const PROSE_ONLY = "none: text is Prose (its fields sit inside sentences or item lines)";

/** Every registered tool → its Labelled lines. The test fails on a tool missing here. */
export const LABELLED_LINES: Readonly<Record<string, ToolLabelledLines>> = {
  calibre_list_libraries: {
    lines: [
      {
        label: "id",
        match: "line",
        pattern: /^.+ \(id: (?<v>[^)]+)\)(?: \[default\])?$/,
        format: "`<Name> (id: <libraryId>)[ [default]]` — one line per library",
        field: "libraries[].id",
        compare: "equal",
      },
    ],
  },
  calibre_get_book: {
    lines: [
      {
        label: "id",
        match: "line",
        pattern: /^id: (?<v>\d+) \| uuid: \S+(?: \| .*)?$/,
        format: "`id: <id> | uuid: <uuid>[ | …]`",
        field: "book.id",
        compare: "equal",
        note: "fields after the uuid are Prose",
      },
    ],
  },
  calibre_search: {
    lines: [
      CURSOR_LINE,
      {
        label: "annotation",
        match: "line",
        pattern: /^annotation (?<v>\d+) · \w+ · book \d+ · .+$/,
        format: "`annotation <id> · <type> · book <bookId> · <format> · <title>` — mode=annotations, one per hit",
        field: "annotations[].id",
        compare: "equal",
        note: "the format and title after `book <bookId>` are Prose",
      },
      {
        label: "note",
        match: "line",
        pattern: /^note · [^:]+: (?<v>.+)$/,
        format: "`note · <field>: <item>` — mode=notes, one per hit",
        field: "notes[].item",
        compare: "equal",
      },
    ],
  },
  calibre_list_categories: { lines: [CURSOR_LINE] },
  calibre_quality_report: { lines: [CURSOR_LINE] },
  calibre_find_duplicates: { lines: [CURSOR_LINE] },
  calibre_get_content: { lines: [CURSOR_LINE] },
  calibre_build_index: {
    lines: [
      {
        label: "Indexed ids",
        match: "line",
        pattern: /^Indexed ids: (?<v>\d+(?:, \d+)*)\.$/,
        format: "`Indexed ids: <id>, <id>.`",
        field: "bookDetails[].bookId",
        compare: "join",
      },
    ],
  },
  calibre_semantic_search: { none: PROSE_ONLY },
  calibre_get_figures: { none: "none: text is Prose; no outputSchema (images ride in content blocks)" },
  calibre_recover_metadata: { none: PROSE_ONLY },
  calibre_extract_isbn: { none: PROSE_ONLY },
  calibre_update_book: { none: PROSE_ONLY },
  calibre_bulk_update: { none: PROSE_ONLY },
  calibre_add_book: { none: PROSE_ONLY },
  calibre_remove_book: { none: PROSE_ONLY },
  calibre_merge_books: { none: PROSE_ONLY },
  calibre_manage_bundles: { none: PROSE_ONLY },
  calibre_board_data: { none: "none: app-only widget tool — the model never sees its text" },
  calibre_open_book: { none: "none: app-only widget tool — the model never sees its text" },
  // No outputSchema, but #448 names its lines: they are the health report a model reads.
  calibre_ping: {
    lines: [
      {
        label: "calibredb",
        match: "line",
        pattern: /^calibredb: (?<v>.+) \(Content Server \S+\)$/,
        format: "`calibredb: <path> (Content Server <url>)`",
        field: "calibredbPath",
        compare: "equal",
      },
      {
        label: "calibre version",
        match: "line",
        pattern: /^calibre version: (?<v>\d+\.\d+(?:\.\d+)?|unknown)$/,
        format: "`calibre version: <x.y[.z]>|unknown` — from `calibredb --version`",
        field: "calibreVersion",
        compare: "equal",
      },
      {
        label: "writes",
        match: "line",
        pattern: /^writes: (?<v>ENABLED|disabled) \(.+\)$/,
        format: "`writes: ENABLED|disabled (…)` — our write gate",
        field: "writeEnabled",
        compare: "format",
        note: "the parenthesis is Prose",
      },
      {
        label: "calibre writes",
        match: "line",
        pattern: /^calibre writes: (?<v>allowed|refused|unknown)(?: .+)?$/,
        format: "`calibre writes: allowed|refused — <how to allow writes>|unknown (<reason>)`",
        field: "calibreWriteAccess",
        compare: "equal",
        note: "the remedy after `refused` and the reason are Prose",
      },
      {
        label: "Semantic search",
        match: "line",
        pattern: /^Semantic search: (?<v>ready|UNAVAILABLE|index STALE)\b.*$/,
        format: "`Semantic search: ready|UNAVAILABLE|index STALE …`",
        field: "semantic.available",
        compare: "format",
        note: "the state word is contract; the explanation and steering sentence are Prose",
      },
      {
        label: "index",
        match: "segment",
        pattern:
          /; (?<v>\S+) index (?:v\d+: \d+ books \/ \d+ chunks \/ \d+ figures, \d+ vectors|busy — index locked by another process, retry)/,
        format:
          "on the Semantic search line: `; <libraryId> index v<N>: <B> books / <C> chunks / <F> figures, <V> vectors` or `; <libraryId> index busy — …`",
        field: "semantic.libraryId",
        compare: "equal",
      },
      {
        label: "Index",
        match: "line",
        pattern: /^Index: (?<v>.+)$/,
        format:
          "`Index: <entry> · <entry>…[ · … +K more — …]` or `skipped — Calibre unreachable` / `skipped — library busy` / `libraries unavailable` / `(no libraries)`",
        field: "indexes",
        compare: "format",
      },
      {
        label: "id",
        match: "segment",
        pattern: /(?:^Index: | · )[^·\n]+? \(id: (?<v>[^)]+)\)(?: \[default\])?: /,
        format:
          "each Index entry: `<Name> (id: <libraryId>)[ [default]]: <N>/<M|?> indexed[ (<K> without embeddings)]|none|stale index (rebuild)|busy — …|not indexable — …|index unreadable` (at most 20)",
        field: "indexes[].id",
        compare: "equal",
      },
      {
        label: "log file",
        match: "line",
        pattern: /^log file: (?<v>.+)$/,
        format: "`log file: <path>|off (stderr only)`",
        field: "logFile",
        compare: "format",
      },
      {
        label: "recent errors",
        match: "line",
        pattern: /^recent errors: (?<v>\d+)(?: \(\d+ occurrences\))?$/,
        format: "`recent errors: <N>[ (<M> occurrences)]`",
        field: "recentErrors",
        compare: "length",
      },
    ],
  },
};

/** The docs table (docs/TOOLS.md "Labelled lines"), generated so the registry is reviewable as a diff. */
export function renderLabelledLinesDoc(): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const rows = ["| Tool | Label | Value format | Structured field |", "|---|---|---|---|"];
  const add = (tool: string, l: LabelledLine) =>
    rows.push(`| ${tool} | \`${l.label}\` | ${cell(l.format)}${l.note ? ` (${cell(l.note)})` : ""} | \`${l.field}\` |`);
  for (const l of ERROR_LINES) add("every tool (error results)", l);
  const none: string[] = [];
  for (const [tool, entry] of Object.entries(LABELLED_LINES)) {
    if ("none" in entry) none.push(`- \`${tool}\` — ${entry.none.replace(/^none: /, "")}`);
    else for (const l of entry.lines) add(`\`${tool}\``, l);
  }
  return [...rows, "", "Tools whose text has no Labelled lines beyond the error lines:", "", ...none].join("\n");
}
