// Parsers for `calibredb annotations` / `calibredb notes` output (Calibre 9.18+, #500, D-029).
// Shapes come from real captures (docs/dev/local-groundtruth.md); calibredb prepends unrelated
// lines such as "Integration status: False" to stdout, so every parser skips them.

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
  const start = stdout.search(/^\[/m);
  if (start < 0) throw new Error("calibredb annotations search returned no JSON array");
  const rows = JSON.parse(stdout.slice(start)) as RawAnnotation[];
  return rows.map((r) => toHit(r, r.annotation ?? {}));
}

/**
 * Parse `annotations export --format json` (`{annotations: [...], type: "calibre_annotation_collection"}`)
 * into the same fields as a search hit, in Calibre's export order. Export rows carry no id and no title.
 */
export function parseAnnotationExport(stdout: string): AnnotationHit[] {
  const start = stdout.search(/^\{/m);
  if (start < 0) throw new Error("calibredb annotations export returned no JSON object");
  const rows = (JSON.parse(stdout.slice(start)) as { annotations?: RawExportRow[] }).annotations ?? [];
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
  return stdout.replace(/^(?:Integration status: .*\n)+/, "").trimEnd();
}

// Calibre's refusal for an item without a note (exit 1, on stderr): a lookup miss, not a fault.
const NO_SUCH_ITEM = /No item named .+ found in the field \S+/;

/** The "No item named X found in the field F" sentence in calibredb's output, if present. */
export function noSuchNoteItem(diag: string | undefined): string | undefined {
  return diag === undefined ? undefined : NO_SUCH_ITEM.exec(diag)?.[0];
}
