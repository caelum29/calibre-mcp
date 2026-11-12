// Search request/response domain shapes. SDK-free; mirror the Content Server
// `/ajax/search` contract but expose only what handlers need.

/** Sortable fields exposed to callers (a safe subset of Calibre's sort keys). */
export type SearchSort = "title" | "authors" | "pubdate" | "timestamp" | "rating" | "last_modified";

export type SortOrder = "asc" | "desc";

/** Inputs to a metadata search against one library. */
export interface SearchParams {
  query: string;
  /** Display name; resolved to a libId by the client. Defaults to config's library. */
  library?: string;
  /** Page size (`num` in the /ajax contract). */
  num?: number;
  offset?: number;
  sort?: SearchSort;
  sortOrder?: SortOrder;
  /** Request timeout; callers under a per-call Deadline pass what is left of it. */
  timeoutMs?: number;
  /** Read-only probes (calibre_ping): skip the busy breaker — a slow probe must not flag the library busy. */
  noBreaker?: boolean;
}

/** Full-text indexing progress of one library: `left` of `total` book files still unindexed. */
export interface FtsIndexing {
  left: number;
  total: number;
}

/** Phase-1 full-text matches: book ids in FTS rank order, plus their title/authors. */
export interface FtsMatches {
  bookIds: number[];
  books: Map<number, { title: string; authors: string[] }>;
  indexing: FtsIndexing;
}

/** One page of search results — ids only; full records are fetched on demand. */
export interface SearchPage {
  bookIds: number[];
  /** Total matches for the query (across all pages). */
  total: number;
  /** Number returned on this page. */
  num: number;
  offset: number;
  /** Effective sort the server applied. */
  sort: string;
  /** The resolved library id (underscored form). */
  libraryId: string;
}

/**
 * The page's id list when it really is one (every entry a number), else undefined. Read paths
 * that act on the ids (#496 ping walk, #579 live-hit check) must treat a malformed page as "no
 * answer", never as "no books".
 */
export function pageIds(page: Pick<SearchPage, "bookIds">): number[] | undefined {
  const got: unknown = page.bookIds;
  return Array.isArray(got) && got.every((id): id is number => typeof id === "number") ? got : undefined;
}
