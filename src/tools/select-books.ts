// Shared book-set selector for the curation tools. Turns a caller's ids/query/library into
// a concrete Book[] via the Content Server, batching the /ajax/books fetch. Capped so a
// library-wide sweep can't pull unbounded records; `capped` tells the tool to say so.

import type { Book } from "../domain/book.js";
import { log } from "../logging.js";
import { resolveNumericId } from "./resolve-id.js";
import type { ToolDeps } from "./types.js";

/** Upper bound on books pulled for one curation run (library sweep). */
export const MAX_BOOKS = 2000;

/** Books fetched per /ajax/books request. */
const BATCH = 200;

// Batches run concurrently up to this cap. The Content Server serializes DB reads,
// so on a healthy local server this is neutral (measured ~2.2s either way for 801
// books); the win is against a latency-bound/slow server, while the small cap keeps
// us polite to the GUI-embedded server (never a thundering herd of requests).
const BATCH_CONCURRENCY = 4;

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

/**
 * Fetch full records for a list of numeric ids, dropping unknown ids. Splits into
 * {@link BATCH}-sized /ajax/books requests run with bounded concurrency
 * ({@link BATCH_CONCURRENCY}); order is preserved so results are deterministic.
 * Times the whole fetch to stderr so a future hang is diagnosable from logs.
 */
async function fetchBooks(deps: ToolDeps, ids: number[], library?: string): Promise<Book[]> {
  if (ids.length === 0) return [];

  // Pre-slice into batches, keeping their index so we can reassemble in order.
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));

  const maps = new Array<Map<number, Book | null>>(batches.length);
  const started = Date.now();
  let next = 0;

  // A fixed pool of workers, each pulling the next un-taken batch. Caps in-flight
  // requests at BATCH_CONCURRENCY without spawning one promise per batch.
  async function worker(): Promise<void> {
    for (;;) {
      const idx = next++;
      const batch = batches[idx];
      if (batch === undefined) return;
      maps[idx] = await deps.content.booksByIds(batch, library);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, () => worker()),
  );

  const books: Book[] = [];
  for (let b = 0; b < batches.length; b++) {
    const map = maps[b];
    const batch = batches[b];
    if (!map || !batch) continue;
    for (const id of batch) {
      const found = map.get(id);
      if (found) books.push(found);
    }
  }
  log.debug("select-books fetched", {
    ids: ids.length,
    batches: batches.length,
    books: books.length,
    ms: Date.now() - started,
  });
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

  const t0 = Date.now();
  const page = await deps.content.search({
    query: args.query ?? "",
    num: MAX_BOOKS,
    library: args.library,
  });
  // Search vs fetch split makes it obvious which stage stalls if a sweep hangs.
  log.debug("select-books searched", {
    query: args.query ?? "",
    matched: page.total,
    returned: page.bookIds.length,
    ms: Date.now() - t0,
  });
  const books = await fetchBooks(deps, page.bookIds, args.library);
  return { books, total: page.total, capped: page.total > page.bookIds.length };
}
