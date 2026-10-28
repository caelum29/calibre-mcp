// In-memory payload cache behind the cover-board widget (issue #22). Claude Desktop
// strips structuredContent/_meta from ui/notifications/tool-result, so the widget pulls
// its data via a widget-initiated tools/call to calibre_board_data — this cache lets that
// re-pull return the finished search instead of re-running it (semantic search costs
// seconds + model load). SDK-free; process-lifetime; single stdio client, so tiny LRU.

/** One cover card on the board. */
export interface BoardBook {
  bookId: number;
  title: string;
  authors: string[];
  /** Semantic score for the badge (cosine, else rerank). Absent = keyword hit, no badge. */
  score?: number;
}

/** Everything the board widget needs to render one search's results. */
export interface BoardPayload {
  /** Originating tool (calibre_search | calibre_semantic_search) — part of the cache key. */
  tool: string;
  query: string;
  /** Drives the widget's score-badge column: semantic payloads carry per-book scores. */
  kind: "keyword" | "semantic";
  /** libId (not display name) — the widget builds /get/thumb/{id}/{libId} URLs from it. */
  libraryId: string;
  /** Content Server base URL for thumb + viewer links (must match the CSP resourceDomains). */
  serverUrl: string;
  lowConfidence?: boolean;
  /** Full match count; the board shows the current page only. */
  total?: number;
  /** Bundle the search was scoped to (#93) — surfaced so the widget can label the board. */
  filter?: string;
  /** Exclusion-marker names subtracted from this search (#93); absent = nothing subtracted. */
  exclusionsApplied?: string[];
  books: BoardBook[];
}

const CAPACITY = 16;

/**
 * LRU of recent library-scope search payloads keyed by (tool, query, libraryId, filter),
 * plus a latest-per-tool pointer for widgets that never received their tool-input args.
 */
export class BoardCache {
  #entries = new Map<string, BoardPayload>();
  #latest = new Map<string, BoardPayload>();

  // Same query in another library or under another bundle is a different board (#215);
  // NUL-joined so no query/bundle text can forge another entry's key.
  #key(tool: string, query: string, libraryId: string, filter?: string): string {
    return [tool, query, libraryId, filter ?? ""].join("\u0000");
  }

  set(payload: BoardPayload): void {
    const key = this.#key(payload.tool, payload.query, payload.libraryId, payload.filter);
    this.#entries.delete(key); // re-insert = move to MRU position
    this.#entries.set(key, payload);
    this.#latest.set(payload.tool, payload);
    if (this.#entries.size > CAPACITY) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
  }

  /**
   * Exact (tool, query, libraryId, filter) hit — a stale-widget re-render must not show
   * another search's books; an absent filter means the unfiltered run. A query always needs
   * its libraryId: a library-agnostic (tool, query) lookup would bring back #215.
   */
  get(tool: string, query: string, libraryId: string, filter?: string): BoardPayload | undefined;
  /** Widgets that never received their tool-input args: latest for the tool, else latest overall. */
  get(tool?: string): BoardPayload | undefined;
  get(tool?: string, query?: string, libraryId?: string, filter?: string): BoardPayload | undefined {
    if (query !== undefined) {
      // untyped callers that skip the libraryId miss rather than get another library's board
      if (tool === undefined || libraryId === undefined) return undefined;
      return this.#entries.get(this.#key(tool, query, libraryId, filter));
    }
    if (tool !== undefined) return this.#latest.get(tool);
    let last: BoardPayload | undefined;
    for (const p of this.#entries.values()) last = p;
    return last;
  }
}
