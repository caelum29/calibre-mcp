// Shared book-set selector for the curation tools. Turns a caller's ids/query/library into
// a concrete Book[] via the Content Server, batching the /ajax/books fetch. Capped so a
// library-wide sweep can't pull unbounded records; `capped` tells the tool to say so.

import type { Book } from "../domain/book.js";
import { resolveNumericId } from "./resolve-id.js";
import type { ToolDeps } from "./types.js";

/** Upper bound on books pulled for one curation run (library sweep). */
export const MAX_BOOKS = 2000;

/** Books fetched per /ajax/books request. */
const BATCH = 200;

export interface SelectArgs {
  ids?: (number | string)[];
  query?: string;
  library?: string;
}

export interface Selection {
  books: Book[];
  /** Total matched before the MAX_BOOKS cap (equals books.length for an ids selection). */
  total: number;
  /** True when the library matched more than MAX_BOOKS — results are a prefix. */
  capped: boolean;
}

/** Fetch full records for a list of numeric ids in batches, dropping unknown ids. */
async function fetchBooks(deps: ToolDeps, ids: number[], library?: string): Promise<Book[]> {
  const books: Book[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const map = await deps.content.booksByIds(slice, library);
    for (const id of slice) {
      const b = map.get(id);
      if (b) books.push(b);
    }
  }
  return books;
}

/**
 * Resolve a selection to Book records. Explicit `ids` win (each resolved via
 * resolveNumericId, so uuids work); otherwise `query` searches the library — an empty query
 * returns all books (verified against the Content Server). The result is capped at MAX_BOOKS.
 */
export async function selectBooks(deps: ToolDeps, args: SelectArgs): Promise<Selection> {
  if (args.ids && args.ids.length > 0) {
    const resolved: number[] = [];
    for (const id of args.ids) {
      const num = await resolveNumericId(deps, id, args.library);
      if (num !== undefined) resolved.push(num);
    }
    const books = await fetchBooks(deps, resolved, args.library);
    return { books, total: books.length, capped: false };
  }

  const page = await deps.content.search({
    query: args.query ?? "",
    num: MAX_BOOKS,
    library: args.library,
  });
  const books = await fetchBooks(deps, page.bookIds, args.library);
  return { books, total: page.total, capped: page.total > page.bookIds.length };
}
