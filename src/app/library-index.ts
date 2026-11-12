// Per-library index coverage for calibre_ping (#346): which libraries have an index, whether it
// is current, and how many books it covers. Read-only and time-boxed — ping must stay fast and
// must never initialise a store file (that would take a write lock).

import type { LibraryReader } from "../calibre/content-server.js";
import type { StatusIndex } from "../semantic/status.js";
import type { IndexFreshness } from "../semantic/store/types.js";
import type { LibraryInfo } from "../domain/library.js";
import { staleness } from "../semantic/staleness.js";
import { Deadline } from "../shared/deadline.js";
import { within } from "../shared/within.js";
import { pageIds } from "../domain/search.js";
import { LibraryIdCollisionError } from "../domain/library-id-collision.js";
import { isIndexBusy } from "../semantic/index-busy.js";

/** One library's index coverage; `total` is null when the Content Server did not answer in time. */
export interface LibraryIndex {
  id: string;
  name: string;
  /** The Content Server's default library (#440). */
  isDefault: boolean;
  /** "busy" (#442): another process holds the index locked — retry, nothing is wrong with it. */
  state: "ok" | "none" | "stale" | "unreadable" | "conflict" | "busy";
  /** state "conflict" (#388): the library whose id equals this one case-insensitively and owns the index file. */
  conflictsWith?: string;
  indexed?: number;
  total?: number | null;
  /** Books in the index with no (or partial) embeddings — keyword-only rows. */
  withoutEmbeddings?: number;
  /**
   * #496: `indexed` is the raw row count, not checked against the library's live ids (the id
   * walk timed out, failed or hit its cap), so it may include removed or merged books.
   */
  indexedUnchecked?: true;
}

/** The reads the report makes: library list + one count per library, and index coverage. */
export interface LibraryIndexDeps {
  content: Pick<LibraryReader, "libraryInfo" | "search">;
  index: Pick<StatusIndex, "hasIndex" | "indexMeta" | "stats" | "booksMissingVectors"> &
    Pick<IndexFreshness, "indexedBookIds">;
}

/** Ids per search page for the live-id walk; most libraries fit in one. */
const LIVE_PAGE = 1000;
// The walk's own cap inside ping's shared budget: one big or slow library must not use it all.
// The first page carries the total (the old count request), so it may use the shared budget.
const LIVE_WALK_MS = 2000;
const LIVE_MAX_PAGES = 5;

/** The library's total and, when the walk finished in time, every live id (#496). */
async function liveIds(
  deps: LibraryIndexDeps,
  library: string,
  deadline: Deadline,
): Promise<{ total: number | null; ids?: Set<number> }> {
  const ids = new Set<number>();
  let total: number | null = null;
  const walk = new Deadline(LIVE_WALK_MS);
  for (let n = 0, offset = 0; ; n++) {
    if (n === LIVE_MAX_PAGES) return { total };
    const left = n === 0 ? deadline.remainingMs() : Math.min(deadline.remainingMs(), walk.remainingMs());
    if (left === 0) return { total };
    const page = await within(
      deps.content
        .search({ query: "", library, num: LIVE_PAGE, offset, timeoutMs: left, noBreaker: true })
        .catch(() => undefined),
      left,
      undefined,
    );
    if (!page) return { total };
    total ??= page.total;
    // a page with no id list, or an empty one short of the total, is an incomplete walk:
    // no live set (ping falls back to the raw count), never "0 live"
    const got = pageIds(page);
    if (!got) return { total };
    if (got.length === 0) return offset >= page.total ? { total, ids } : { total };
    for (const id of got) ids.add(id);
    offset += got.length;
    if (offset >= page.total) return { total, ids };
  }
}

/** The whole index section (libraryInfo + every count) gets one short budget, so ping stays fast. */
const INDEX_DEADLINE_MS = 5000;

/**
 * Per-library index coverage, or undefined when the library list is unavailable. Each library
 * degrades on its own (unknown total → null, store error, stale index) and this never throws.
 * Reads only existing public IndexStore methods and never opens a store that has no meta row.
 * The count goes through `noBreaker` so a slow read-only probe cannot flag the library busy.
 */
export async function libraryIndexReport(deps: LibraryIndexDeps): Promise<LibraryIndex[] | undefined> {
  // One clock for the whole section: a slow libraryInfo leaves the counts less time (#325).
  const deadline = new Deadline(INDEX_DEADLINE_MS);
  let info: LibraryInfo | undefined;
  try {
    info = await within(deps.content.libraryInfo(), deadline.remainingMs(), undefined);
  } catch {
    info = undefined;
  }
  const map = info?.libraryMap;
  if (!map) return undefined;
  return Promise.all(
    Object.entries(map).map(async ([id, name]): Promise<LibraryIndex> => {
      const lib = { id, name, isDefault: id === info?.defaultLibrary };
      try {
        if (!deps.index.hasIndex(id)) return { ...lib, state: "none" };
        const meta = deps.index.indexMeta(id, { diagnostic: true });
        if (!meta) return { ...lib, state: "unreadable" };
        if (staleness(meta) !== undefined) return { ...lib, state: "stale" };
        // Keyword-only books are FTS-searchable, so they count as indexed; semantic search can't
        // reach them, so the report says how many (#325).
        // every index read before the first request: a damaged store fails without a library round-trip
        const rows = deps.index.stats(id).books;
        const withoutEmbeddings = deps.index.booksMissingVectors(id);
        const rowIds = deps.index.indexedBookIds(id);
        const { total, ids } = await liveIds(deps, id, deadline);
        // Only books the library still holds count (#496): rows of removed/merged books are
        // orphans. Without a complete live set, fall back to the raw row count.
        if (!ids) return { ...lib, state: "ok", indexed: rows, total, withoutEmbeddings, indexedUnchecked: true };
        const indexed = rowIds.filter((b) => ids.has(b)).length;
        return { ...lib, state: "ok", indexed, total, withoutEmbeddings };
      } catch (err) {
        if (err instanceof LibraryIdCollisionError) return { ...lib, state: "conflict", conflictsWith: err.owner };
        // a lock is transient, not damage: say so instead of "unreadable" (#442)
        if (isIndexBusy(err)) return { ...lib, state: "busy" };
        return { ...lib, state: "unreadable" };
      }
    }),
  );
}
