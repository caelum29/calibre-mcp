// calibre_search mode=annotations / mode=notes (#500, D-029): read the highlights, bookmarks and
// item notes Calibre 9.18 exposes through calibredb. Read-only; behind the Calibre version gate.
// Annotations respect Bundles and Exclusion markers (calibredb --search); notes attach to items
// (authors, series, tags…), not books, so filters do not apply to them.

import { honestyLines, resolveFilter, scopeExpression } from "../app/bundles.js";
import { resolveNumericId } from "../app/resolve-id.js";
import {
  type AnnotationHit,
  type NoteHit,
  isFts5QueryError,
  noSuchNoteItem,
  parseAnnotationExport,
  parseAnnotationSearch,
  parseNoteSearch,
  parseNoteShow,
} from "../calibre/annotations.js";
import { calibredbArgv } from "../calibre/calibredb-argv.js";
import { CalibreCliError } from "../domain/errors.js";
import type { LibId } from "../calibre/lib-id.js";
import type { Deadline } from "../shared/deadline.js";
import { calibreTooOld } from "./calibre-version-gate.js";
import type { BaseDeps } from "./deps.js";
import { fence, toolError, toolErrorFrom, toolText } from "./result.js";
import type { ToolResult } from "./types.js";

/** The calibre_search args these modes read. */
export interface AnnotationNoteArgs {
  query: string;
  mode: "annotations" | "notes";
  scope: "library" | "book";
  bookId?: number | string;
  library?: string;
  sort?: string;
  limit: number;
  cursor?: string;
  countOnly?: boolean;
  filter?: string;
  include_excluded?: boolean;
}

// annotations and notes need calibredb subcommands added in Calibre 9.18
const MIN_CALIBRE = "9.18";

// Decided by Artem (#500): with scope=book, `query: "*"` lists every annotation of the book
const WHOLE_BOOK = "*";

// Decided by Artem (#500): in mode=notes, `<notes field>:<item>` shows that item's note.
// Notes attach to these fields (and custom ones, `#name`); an item may be quoted.
const NOTE_ITEM = /^(authors|series|tags|publisher|#\w+):\s*(?:"([^"]+)"|(.+))$/s;

/** `{field, item}` when the query names one item's note, else undefined (a plain notes search). */
function noteItem(query: string): { field: string; item: string } | undefined {
  const m = NOTE_ITEM.exec(query.trim());
  if (!m) return undefined;
  const item = (m[2] ?? m[3] ?? "").trim();
  return item ? { field: m[1]!, item } : undefined;
}

/** Run mode=annotations or mode=notes; the version gate runs before any calibredb spawn. */
export async function searchAnnotationsOrNotes(
  args: AnnotationNoteArgs,
  deps: BaseDeps,
  deadline: Deadline,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tooOld = await calibreTooOld(deps.calibre, MIN_CALIBRE);
  if (tooOld) return tooOld;
  // calibredb returns the whole hit list at once: there is no page to walk or re-sort
  if (args.cursor !== undefined || args.sort !== undefined) {
    return toolError(
      "invalid_input",
      `cursor and sort apply to mode=meta/fts only — mode=${args.mode} returns Calibre's relevance order, capped by limit.`,
    );
  }
  return args.mode === "notes" ? notes(args, deps, deadline, signal) : annotations(args, deps, deadline, signal);
}

async function annotations(
  args: AnnotationNoteArgs,
  deps: BaseDeps,
  deadline: Deadline,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let restrict: string;
  let honesty: string[] = [];
  let filterFields: Record<string, unknown> = {};
  if (args.scope === "book") {
    if (args.filter !== undefined) {
      return toolError(
        "invalid_input",
        "filter (bundle) applies to scope=library only — scope=book already names one book.",
      );
    }
    if (args.bookId === undefined) return toolError("invalid_input", "scope=book requires bookId");
    const bookId = await resolveNumericId(deps, args.bookId, args.library);
    if (bookId === undefined) return toolError("not_found", `No book with id/uuid ${args.bookId}`);
    restrict = `id:${bookId}`;
  } else if (args.query.trim() === WHOLE_BOOK) {
    return toolError(
      "invalid_input",
      `query "*" lists the annotations of one book — add scope: "book" and bookId, or search with a word.`,
    );
  } else {
    // same Bundle + Exclusion-marker rules as meta/fts, applied as calibredb's book restriction
    const fr = await resolveFilter(deps, {
      filter: args.filter,
      includeExcluded: args.include_excluded,
      autoExclude: true,
      library: args.library,
      timeoutMs: deadline.timeoutFor(),
    });
    if (!fr.ok) return toolErrorFrom(fr.cause, fr.error);
    restrict = scopeExpression(fr.res);
    honesty = honestyLines(fr.res);
    filterFields = {
      ...(fr.res.bundle ? { filter: fr.res.bundle.name } : {}),
      ...(fr.res.markers.length > 0 ? { exclusionsApplied: fr.res.markers.map((m) => m.name) } : {}),
    };
  }

  const libId = await deps.content.resolveLibraryId(args.library);
  // "*" in a book: search refuses an empty term, so the whole book comes from export
  const wholeBook = args.scope === "book" && args.query.trim() === WHOLE_BOOK;
  const argv = wholeBook
    ? ["annotations", "export", "--search", restrict, "--format", "json"]
    : calibredbArgv(
        ["annotations", "search"],
        [args.query],
        ["--format", "json", ...(restrict ? ["--search", restrict] : [])],
      );
  const out = await runSearch(deps, argv, args.query, { library: libId, timeoutMs: deadline.timeoutFor(), signal });
  if (!("stdout" in out)) return out;
  const { stdout } = out;
  const all = wholeBook ? parseAnnotationExport(stdout) : parseAnnotationSearch(stdout);
  if (wholeBook) await fillTitle(all, restrictedId(restrict), deps, args.library);
  const tail = honesty.length > 0 ? `\n${honesty.join("\n")}` : "";
  const q = JSON.stringify(args.query);

  if (args.countOnly) {
    return toolText(`${all.length} annotations match ${q}.${tail}`, {
      total: all.length,
      query: args.query,
      ...filterFields,
    });
  }
  const shown = all.slice(0, args.limit);
  const lead = wholeBook
    ? `${all.length} annotations in this book (Calibre's export order)${all.length ? `, showing 1–${shown.length}` : ""}.`
    : all.length === 0
      ? `0 annotations matched ${q}.`
      : `Found ${all.length} annotations matching ${q} (Calibre's relevance order), showing 1–${shown.length}.`;
  const text = [lead + tail, ...shown.map(renderAnnotation)].join("\n\n");
  return toolText(text, {
    total: all.length,
    count: shown.length,
    mode: "annotations",
    scope: args.scope,
    annotations: shown,
    ...filterFields,
  });
}

const restrictedId = (restrict: string): number => Number(restrict.slice("id:".length));

/** Export rows carry no title: take it from the one book, looked up once. A failed lookup leaves them untitled. */
async function fillTitle(rows: AnnotationHit[], bookId: number, deps: BaseDeps, library?: string): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { title } = await deps.content.getBook(bookId, library);
    // the export is restricted to one book; only that book's rows get its title
    for (const row of rows) if (row.bookId === bookId) row.title = title;
  } catch {
    // the title is polish: the listing is still correct without it
  }
}

/** One hit: a Labelled header line, then the reader's text and note fenced as data. */
function renderAnnotation(a: AnnotationHit): string {
  // export rows (a whole book) carry no annotation id; the title is filled from the book
  const id = a.id === undefined ? "" : ` ${a.id}`;
  const lines = [`annotation${id} · ${a.type} · book ${a.bookId} · ${a.format}${a.title ? ` · ${a.title}` : ""}`];
  if (a.chapter) lines.push(`chapter: ${a.chapter}`);
  lines.push(`by ${a.user}${a.timestamp ? ` at ${a.timestamp}` : ""}`);
  lines.push(fence(a.type === "bookmark" ? "BOOKMARK TITLE" : "HIGHLIGHT", a.text));
  if (a.note) lines.push(fence("ANNOTATION NOTE", a.note));
  return lines.join("\n");
}

async function notes(
  args: AnnotationNoteArgs,
  deps: BaseDeps,
  deadline: Deadline,
  signal?: AbortSignal,
): Promise<ToolResult> {
  // notes belong to authors/series/tags…, not to books: book scoping cannot apply
  if (args.filter !== undefined || args.scope === "book") {
    return toolError(
      "invalid_input",
      "mode=notes searches notes attached to authors, series, tags and other items — filter and scope=book apply to books, not notes.",
    );
  }
  const libId = await deps.content.resolveLibraryId(args.library);
  const one = noteItem(args.query);
  if (one) return showNote(one, libId, deps, deadline, signal);
  const out = await runSearch(deps, calibredbArgv(["notes", "search"], [args.query]), args.query, {
    library: libId,
    timeoutMs: deadline.timeoutFor(),
    signal,
  });
  if (!("stdout" in out)) return out;
  const { stdout } = out;
  const all = parseNoteSearch(stdout);
  const q = JSON.stringify(args.query);
  if (args.countOnly) return toolText(`${all.length} notes match ${q}.`, { total: all.length, query: args.query });
  const shown = all.slice(0, args.limit);
  const lead =
    all.length === 0
      ? `0 notes matched ${q}.`
      : `Found ${all.length} notes matching ${q} (Calibre's relevance order), showing 1–${shown.length}.`;
  return toolText([lead, ...shown.map(renderNote)].join("\n\n"), {
    total: all.length,
    count: shown.length,
    mode: "notes",
    notes: shown,
  });
}

/** One note hit: a Labelled `note · field: item` line, then the snippet or whole note fenced as data. */
function renderNote(n: NoteHit): string {
  const body = n.text === undefined ? fence("NOTE SNIPPET", n.snippet ?? "") : fence("NOTE", n.text);
  return `note · ${n.field}: ${n.item}\n${body}`;
}

type CalibredbOptions = Parameters<BaseDeps["calibre"]["calibredb"]>[1];

/** Run an annotation/note search; a query calibre's FTS5 parser refuses is invalid_input. */
async function runSearch(
  deps: BaseDeps,
  argv: string[],
  query: string,
  opts: CalibredbOptions,
): Promise<{ stdout: string } | ToolResult> {
  try {
    return { stdout: (await deps.calibre.calibredb(argv, opts)).stdout };
  } catch (err) {
    if (!(err instanceof CalibreCliError && isFts5QueryError(err.stderr))) throw err;
    return toolError(
      "invalid_input",
      `Calibre could not parse the search query ${JSON.stringify(query)}. Use plain words, put a phrase in ` +
        `double quotes, and leave out a bare "-" or other operators.`,
    );
  }
}

/** `notes show FIELD ITEM`: the whole note (Markdown); an item without one is not_found. */
async function showNote(
  one: { field: string; item: string },
  libId: LibId,
  deps: BaseDeps,
  deadline: Deadline,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let stdout: string;
  try {
    ({ stdout } = await deps.calibre.calibredb(calibredbArgv(["notes", "show", one.field], [one.item]), {
      library: libId,
      timeoutMs: deadline.timeoutFor(),
      signal,
    }));
  } catch (err) {
    const miss = err instanceof CalibreCliError ? noSuchNoteItem(err.stderr) : undefined;
    if (miss === undefined) throw err;
    return toolError(
      "not_found",
      `${miss}. Search notes with a plain word (mode: "notes") to see which items have one.`,
    );
  }
  const hit: NoteHit = { field: one.field, item: one.item, text: parseNoteShow(stdout) };
  return toolText(renderNote(hit), { total: 1, count: 1, mode: "notes", notes: [hit] });
}
