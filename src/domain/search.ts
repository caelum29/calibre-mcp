// Search request/response domain shapes. SDK-free; mirror the Content Server
// `/ajax/search` contract but expose only what handlers need.

/** Sortable fields exposed to callers (a safe subset of Calibre's sort keys). */
export type SearchSort =
  | "title"
  | "authors"
  | "pubdate"
  | "timestamp"
  | "rating"
  | "last_modified";

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
