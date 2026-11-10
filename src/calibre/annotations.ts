// Parsers for `calibredb annotations` / `calibredb notes` output (Calibre 9.18+, #500, D-029).
// Shapes come from real captures (docs/dev/local-groundtruth.md); calibredb prepends unrelated
// lines such as "Integration status: False" to stdout, so every parser skips them.

import { stripCalibredbBanner } from "../domain/calibredb-banner.js";

/** One highlight or bookmark, as calibre_search mode=annotations returns it. */
export interface AnnotationHit {
  /** Calibre's annotation id; `annotations export` (a whole book) does not carry it. */
  id?: number;
  bookId: number;
  /** The book title; `annotations export` does not carry it. */
  title?: string;
  format: string;
  /** `highlight` or `bookmark` (Calibre's `annotation.type`). */
  type: string;
  /** The highlighted text, or a bookmark's title. */
  text: string;
  /** The reader's note on a highlight, when there is one. */
  note?: string;
  /** The book's TOC path to the highlight (`Chapter › Section`), when Calibre records it. */
  chapter?: string;
  timestamp?: string;
  /** `<user_type>:<user>` — `local:viewer` is the Calibre E-book viewer. */
  user: string;
}

/** One note: the item it is attached to, plus Calibre's search snippet or the whole note (Markdown). */
export interface NoteHit {
  field: string;
  item: string;
  /** `notes search`: Calibre's excerpt around the match. */
  snippet?: string;
  /** `notes show`: the whole note as Markdown. */
  text?: string;
}

// One row of `annotations export --format json`: the annotation's own fields, flat, plus book_id.
interface RawExportRow {
  book_id: number;
  format: string;
  type?: string;
  highlighted_text?: string;
  notes?: string;
  title?: string;
  timestamp?: string;
  toc_family_titles?: string[];
  user: string;
  user_type: string;
}

interface RawAnnotation {
  annotation?: {
    type?: string;
    highlighted_text?: string;
    notes?: string;
    title?: string;
    timestamp?: string;
    toc_family_titles?: string[];
  };
  book_id: number;
  format: string;
  id: number;
  text?: string;
  title: string;
  user: string;
  user_type: string;
}

/** Parse `annotations search … --format json` (a JSON array; `[]` on no match), in Calibre's order. */
export function parseAnnotationSearch(stdout: string): AnnotationHit[] {
  const rows = JSON.parse(firstJsonValue(stdout, "[", "annotations search")) as RawAnnotation[];
  return rows.map((r) => toHit(r, r.annotation ?? {}));
}

/**
 * Parse `annotations export --format json` (`{annotations: [...], type: "calibre_annotation_collection"}`)
 * into the same fields as a search hit, in Calibre's export order. Export rows carry no id and no title.
 */
export function parseAnnotationExport(stdout: string): AnnotationHit[] {
  const json = firstJsonValue(stdout, "{", "annotations export");
  const rows = (JSON.parse(json) as { annotations?: RawExportRow[] }).annotations ?? [];
  return rows.map((r) => toHit({ book_id: r.book_id, format: r.format, user: r.user, user_type: r.user_type }, r));
}

type HitBase = Pick<RawAnnotation, "book_id" | "format" | "user" | "user_type"> &
  Partial<Pick<RawAnnotation, "id" | "title" | "text">>;

function toHit(r: HitBase, a: NonNullable<RawAnnotation["annotation"]>): AnnotationHit {
  const type = a.type ?? "unknown";
  // a bookmark has no highlighted text; its title is what the reader named it
  const text = (type === "bookmark" ? a.title : a.highlighted_text) ?? r.text ?? "";
  const chapter = a.toc_family_titles?.length ? a.toc_family_titles.join(" › ") : undefined;
  return {
    ...(r.id === undefined ? {} : { id: r.id }),
    bookId: r.book_id,
    ...(r.title === undefined ? {} : { title: r.title }),
    format: r.format,
    type,
    text,
    ...(a.notes ? { note: a.notes } : {}),
    ...(chapter ? { chapter } : {}),
    ...(a.timestamp ? { timestamp: a.timestamp } : {}),
    user: `${r.user_type}:${r.user}`,
  };
}

/** Parse `notes search` TSV (`field<TAB>item<TAB>snippet` per line), in Calibre's order. */
export function parseNoteSearch(stdout: string): NoteHit[] {
  return stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 3)
    .map(([field, item, ...rest]) => ({ field: field!, item: item!, snippet: rest.join("\t") }));
}

/** Parse `notes show FIELD ITEM` stdout: the note as Markdown, without calibredb's leading noise. */
export function parseNoteShow(stdout: string): string {
  return stripCalibredbBanner(stdout).trimEnd();
}

// Calibre's refusal for an item without a note (exit 1, on stderr): a lookup miss, not a fault.
const NO_SUCH_ITEM = /No item named .+ found in the field \S+/;

/** The "No item named X found in the field F" sentence in calibredb's output, if present. */
export function noSuchNoteItem(diag: string | undefined): string | undefined {
  return diag === undefined ? undefined : NO_SUCH_ITEM.exec(diag)?.[0];
}

/**
 * The JSON value that starts on the first line beginning with `open`, cut at its matching close:
 * calibredb may print lines before it (the "Integration status" banner) and after it (warnings).
 */
function firstJsonValue(stdout: string, open: "[" | "{", what: string): string {
  const body = stripCalibredbBanner(stdout);
  const start = body.search(open === "[" ? /^\[/m : /^\{/m);
  if (start < 0) throw new Error(`calibredb ${what} returned no JSON`);
  let depth = 0;
  let inString = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (c === "\\") i++; // skip the escaped character
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "{") depth++;
    else if ((c === "]" || c === "}") && --depth === 0) return body.slice(start, i + 1);
  }
  throw new Error(`calibredb ${what} returned truncated JSON`);
}

// calibre's FTS5 parser refused the query (exit 1, stderr): the caller's input, not a fault
const FTS5_PARSE_ERROR = /Failed to parse search query: .* with error: fts5: /;

/** True when calibredb's output says the annotation/note search query is not valid FTS5. */
export function isFts5QueryError(diag: string | undefined): boolean {
  return diag !== undefined && FTS5_PARSE_ERROR.test(diag);
}

/**
 * argv for a calibredb subcommand whose last arguments are user text. A positional starting
 * with "-" would be read as a flag (`--help`, `-s`), so then the options go first and `--`
 * ends option parsing; otherwise the argv keeps calibredb's documented order.
 */
export function calibredbArgv(head: string[], positionals: string[], options: string[] = []): string[] {
  return positionals.some((p) => p.startsWith("-"))
    ? [...head, ...options, "--", ...positionals]
    : [...head, ...positionals, ...options];
}
