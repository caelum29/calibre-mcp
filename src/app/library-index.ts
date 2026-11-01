// Per-library index coverage for calibre_ping (#346): which libraries have an index, whether it
// is current, and how many books it covers. Read-only and time-boxed — ping must stay fast and
// must never initialise a store file (that would take a write lock).

import type { LibraryReader } from "../calibre/content-server.js";
import { staleness, type StatusIndex } from "../semantic/status.js";

/** One library's index coverage; `total` is null when the Content Server did not answer in time. */
export interface LibraryIndex {
  id: string;
  name: string;
  state: "ok" | "none" | "stale" | "unreadable";
  indexed?: number;
  total?: number | null;
  /** Books in the index with no (or partial) embeddings — keyword-only rows. */
  withoutEmbeddings?: number;
}

/** The reads the report makes: library list + one count per library, and index coverage. */
export interface LibraryIndexDeps {
  content: Pick<LibraryReader, "libraryInfo" | "search">;
  index: Pick<StatusIndex, "hasIndex" | "indexMeta" | "stats" | "booksMissingVectors">;
}

/** The whole index section (libraryInfo + every count) gets one short budget, so ping stays fast. */
const INDEX_DEADLINE_MS = 5000;

/** Resolves `fallback` if `p` has not settled by `ms`; the timer never outlives the race. */
async function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-library index coverage, or undefined when the library list is unavailable. Each library
 * degrades on its own (unknown total → null, store error, stale index) and this never throws.
 * Reads only existing public IndexStore methods and never opens a store that has no meta row.
 * The count goes through `noBreaker` so a slow read-only probe cannot flag the library busy.
 */
export async function libraryIndexReport(deps: LibraryIndexDeps): Promise<LibraryIndex[] | undefined> {
  // One clock for the whole section: a slow libraryInfo leaves the counts less time (#325).
  const started = Date.now();
  let map: Record<string, string> | undefined;
  try {
    map = (await within(deps.content.libraryInfo(), INDEX_DEADLINE_MS, undefined))?.libraryMap;
  } catch {
    map = undefined;
  }
  if (!map) return undefined;
  return Promise.all(
    Object.entries(map).map(async ([id, name]): Promise<LibraryIndex> => {
      try {
        if (!deps.index.hasIndex(id)) return { id, name, state: "none" };
        const meta = deps.index.indexMeta(id);
        if (!meta) return { id, name, state: "unreadable" };
        if (staleness(meta) !== undefined) return { id, name, state: "stale" };
        // Keyword-only books are FTS-searchable, so they count as indexed; semantic search can't
        // reach them, so the report says how many (#325).
        const indexed = deps.index.stats(id).books;
        const withoutEmbeddings = deps.index.booksMissingVectors(id);
        const left = Math.max(0, INDEX_DEADLINE_MS - (Date.now() - started));
        const total = await within(
          deps.content
            .search({ query: "", library: id, num: 0, timeoutMs: left, noBreaker: true })
            .then((r) => r.total as number | null)
            .catch(() => null),
          left,
          null,
        );
        return { id, name, state: "ok", indexed, total, withoutEmbeddings };
      } catch {
        return { id, name, state: "unreadable" };
      }
    }),
  );
}
