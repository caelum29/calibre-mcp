// Board wiring on the search tools (issue #22): library-scope results must populate the
// BoardCache (widget re-pull path) AND attach the same payload as _meta.calibreBoard
// (spec-host notification path); book scope must leave both alone.

import { describe, it, expect } from "vitest";
import { searchTool } from "../../src/tools/calibre_search.js";
import { semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import { BoardCache, type BoardPayload } from "../../src/ui/board-cache.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { SearchPage } from "../../src/domain/search.js";
import type { LibraryHit } from "../../src/semantic/store.js";
import type { ToolDeps } from "../../src/tools/types.js";

const book = (id: number): Book => ({
  id,
  uuid: `u-${id}`,
  title: `Book ${id}`,
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
});

const page: SearchPage = {
  bookIds: [1, 2],
  total: 2,
  num: 2,
  offset: 0,
  sort: "title",
  libraryId: "Programming_Books",
};

function metaSearchDeps(cache: BoardCache): ToolDeps {
  return {
    config: loadConfig({}),
    content: {
      search: async () => page,
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)])),
      resolveLibraryId: async () => "Programming_Books",
    } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    boardCache: cache,
    log,
  };
}

const libHit = (bookId: number): LibraryHit => ({
  bookId,
  title: `Book ${bookId}`,
  authors: ["A"],
  score: 0.9,
  charStart: 0,
  charEnd: 10,
  snippet: "snippet",
  body: "body",
});

function semanticDeps(cache: BoardCache): ToolDeps {
  return {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
    } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    embedder: {
      embedQuery: async () => new Float32Array(4),
    } as unknown as ToolDeps["embedder"],
    index: {
      hasIndex: () => true,
      hasVectors: () => true,
      searchLibrary: () => [libHit(1), libHit(2)],
      searchLibraryFts: () => [],
    } as unknown as ToolDeps["index"],
    boardCache: cache,
    log,
  };
}

describe("calibre_search board wiring", () => {
  it("should_cache_and_attach_board_payload_on_library_meta_search", async () => {
    const cache = new BoardCache();
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20 },
      metaSearchDeps(cache),
    );
    const attached = (r._meta as { calibreBoard: BoardPayload }).calibreBoard;
    expect(attached.books.map((b) => b.bookId)).toEqual([1, 2]);
    expect(attached.books[0].title).toBe("Book 1");
    expect(cache.get("calibre_search", "rust")).toEqual(attached);
  });

  it("should_keep_structured_content_unchanged_for_non_apps_hosts", async () => {
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20 },
      metaSearchDeps(new BoardCache()),
    );
    expect(Object.keys(r.structuredContent ?? {})).not.toContain("calibreBoard");
  });

  // Issue #68: aggregate/zero responses must never attach entity-level UI.
  it("should_not_cache_or_attach_board_payload_on_zero_meta_results", async () => {
    const cache = new BoardCache();
    const deps = metaSearchDeps(cache);
    (deps.content as { search: unknown }).search = async () => ({ ...page, bookIds: [], total: 0 });
    const r = await searchTool.handler({ query: "zzz", mode: "meta", scope: "library", limit: 20 }, deps);
    expect(r._meta).toBeUndefined();
    expect(cache.get("calibre_search", "zzz")).toBeUndefined();
  });

  // Issue #67 ratchet: count answers are aggregates — never entity-level UI.
  it("should_not_cache_or_attach_board_payload_on_count_only", async () => {
    const cache = new BoardCache();
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20, countOnly: true },
      metaSearchDeps(cache),
    );
    expect(r._meta).toBeUndefined();
    expect(cache.get("calibre_search", "rust")).toBeUndefined();
  });

  it("should_not_cache_or_attach_board_payload_on_zero_fts_results", async () => {
    const cache = new BoardCache();
    const deps = metaSearchDeps(cache);
    (deps.calibre as unknown as Record<string, unknown>).ftsSearch = async () => [];
    const r = await searchTool.handler({ query: "zzz", mode: "fts", scope: "library", limit: 20 }, deps);
    expect(r._meta).toBeUndefined();
    expect(cache.get("calibre_search", "zzz")).toBeUndefined();
  });
});

describe("calibre_semantic_search board wiring", () => {
  it("should_cache_and_attach_scored_payload_on_library_scope", async () => {
    const cache = new BoardCache();
    const r = await semanticSearchTool.handler(
      { query: "distributed systems", scope: "library", mode: "vector", topK: 10 },
      semanticDeps(cache),
    );
    const attached = (r._meta as { calibreBoard: BoardPayload }).calibreBoard;
    expect(attached.kind).toBe("semantic");
    expect(attached.books[0].score).toBeCloseTo(0.9);
    expect(cache.get("calibre_semantic_search", "distributed systems")).toEqual(attached);
  });

  it("should_not_cache_or_attach_board_payload_on_zero_semantic_results", async () => {
    const cache = new BoardCache();
    const deps = semanticDeps(cache);
    (deps.index as unknown as Record<string, unknown>).searchLibrary = () => [];
    const r = await semanticSearchTool.handler(
      { query: "zzz", scope: "library", mode: "vector", topK: 10 },
      deps,
    );
    expect(r._meta).toBeUndefined();
    expect(cache.get("calibre_semantic_search", "zzz")).toBeUndefined();
  });

  it("should_not_attach_board_payload_on_book_scope", async () => {
    const cache = new BoardCache();
    const deps = semanticDeps(cache);
    (deps.index as unknown as Record<string, unknown>).isBookIndexed = () => true;
    (deps.index as unknown as Record<string, unknown>).searchBook = () => [];
    const r = await semanticSearchTool.handler(
      { query: "q", scope: "book", mode: "vector", bookId: 1, topK: 10 },
      deps,
    );
    expect(r._meta).toBeUndefined();
    expect(cache.get("calibre_semantic_search", "q")).toBeUndefined();
  });
});
