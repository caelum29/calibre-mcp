import { describe, it, expect } from "vitest";
import { BoardCache, type BoardPayload } from "../../src/ui/board-cache.js";

const payload = (over: Partial<BoardPayload> = {}): BoardPayload => ({
  tool: "calibre_search",
  query: "rust",
  kind: "keyword",
  libraryId: "Programming_Books",
  serverUrl: "http://localhost:8080",
  books: [{ bookId: 1, title: "The Rust Programming Language", authors: ["Steve Klabnik"] }],
  ...over,
});

describe("BoardCache", () => {
  it("should_return_exact_payload_for_tool_and_query", () => {
    const cache = new BoardCache();
    cache.set(payload());
    expect(cache.get("calibre_search", "rust", "Programming_Books")?.books).toHaveLength(1);
  });

  it("should_miss_on_unknown_query_instead_of_returning_another_search", () => {
    const cache = new BoardCache();
    cache.set(payload());
    expect(cache.get("calibre_search", "kafka", "Programming_Books")).toBeUndefined();
  });

  it("should_return_latest_for_tool_when_query_missing", () => {
    const cache = new BoardCache();
    cache.set(payload({ query: "rust" }));
    cache.set(payload({ query: "kafka", tool: "calibre_semantic_search" }));
    expect(cache.get("calibre_search")?.query).toBe("rust");
    expect(cache.get("calibre_semantic_search")?.query).toBe("kafka");
  });

  it("should_return_latest_overall_when_no_key_given", () => {
    const cache = new BoardCache();
    cache.set(payload({ query: "rust" }));
    cache.set(payload({ query: "kafka" }));
    expect(cache.get()?.query).toBe("kafka");
  });

  it("should_overwrite_same_key_instead_of_duplicating", () => {
    const cache = new BoardCache();
    cache.set(payload({ books: [] }));
    cache.set(payload());
    expect(cache.get("calibre_search", "rust", "Programming_Books")?.books).toHaveLength(1);
  });

  it("should_evict_oldest_entry_past_capacity", () => {
    const cache = new BoardCache();
    for (let i = 0; i < 17; i++) cache.set(payload({ query: `q${i}` }));
    expect(cache.get("calibre_search", "q0", "Programming_Books")).toBeUndefined();
    expect(cache.get("calibre_search", "q16", "Programming_Books")).toBeDefined();
  });
});

// #215 — the key is (tool, query, libraryId, filter): the same query run in another
// library or under another bundle filter must neither overwrite nor leak into this board.
describe("BoardCache — library/filter scoped keys (#215)", () => {
  const titled = (title: string, over: Partial<BoardPayload> = {}): BoardPayload =>
    payload({ books: [{ bookId: 7, title, authors: ["X"] }], ...over });

  it("should_return_first_library_payload_after_same_query_ran_in_second_library", () => {
    const cache = new BoardCache();
    cache.set(titled("from-prog", { libraryId: "Programming_Books" }));
    cache.set(titled("from-research", { libraryId: "Reaserch_Books" }));
    expect(cache.get("calibre_search", "rust", "Programming_Books")?.books[0]?.title).toBe("from-prog");
  });

  it("should_return_second_library_payload_for_its_own_library", () => {
    const cache = new BoardCache();
    cache.set(titled("from-prog", { libraryId: "Programming_Books" }));
    cache.set(titled("from-research", { libraryId: "Reaserch_Books" }));
    expect(cache.get("calibre_search", "rust", "Reaserch_Books")?.books[0]?.title).toBe("from-research");
  });

  it("should_return_first_filter_payload_after_same_query_ran_under_another_filter", () => {
    const cache = new BoardCache();
    cache.set(titled("bundle-a", { filter: "Systems" }));
    cache.set(titled("bundle-b", { filter: "Web" }));
    expect(cache.get("calibre_search", "rust", "Programming_Books", "Systems")?.books[0]?.title).toBe("bundle-a");
  });

  it("should_return_unfiltered_payload_when_filter_missing_even_if_filtered_run_is_newer", () => {
    const cache = new BoardCache();
    cache.set(titled("unfiltered"));
    cache.set(titled("filtered", { filter: "Systems" }));
    expect(cache.get("calibre_search", "rust", "Programming_Books")?.books[0]?.title).toBe("unfiltered");
  });

  it("should_miss_instead_of_returning_a_filtered_board_for_an_unfiltered_lookup", () => {
    const cache = new BoardCache();
    cache.set(titled("filtered", { filter: "Systems" }));
    expect(cache.get("calibre_search", "rust", "Programming_Books")).toBeUndefined();
  });

  it("should_miss_on_a_library_that_never_ran_the_query", () => {
    const cache = new BoardCache();
    cache.set(titled("from-prog", { libraryId: "Programming_Books" }));
    expect(cache.get("calibre_search", "rust", "Reaserch_Books")).toBeUndefined();
  });

  it("should_overwrite_same_library_and_filter_with_the_newer_run", () => {
    const cache = new BoardCache();
    cache.set(titled("first", { filter: "Systems" }));
    cache.set(titled("second", { filter: "Systems" }));
    expect(cache.get("calibre_search", "rust", "Programming_Books", "Systems")?.books[0]?.title).toBe("second");
  });
});

describe("BoardCache — key edge cases (#215 mutation follow-up)", () => {
  it("should_not_let_query_and_library_text_shift_into_the_same_key", () => {
    const cache = new BoardCache();
    cache.set(payload({ query: "rust", libraryId: "X_Books" }));
    expect(cache.get("calibre_search", "rustX", "_Books")).toBeUndefined();
  });

  it("should_miss_when_a_query_lookup_has_no_library", () => {
    const cache = new BoardCache();
    cache.set(payload({ libraryId: "Reaserch_Books" }));
    // @ts-expect-error a query lookup must name its library (#215)
    expect(cache.get("calibre_search", "rust")).toBeUndefined();
  });

  it("should_scope_the_lookup_to_the_requested_tool", () => {
    const cache = new BoardCache();
    cache.set(payload({ tool: "calibre_search", kind: "keyword" }));
    cache.set(payload({ tool: "calibre_semantic_search", kind: "semantic" }));
    expect(cache.get("calibre_search", "rust", "Programming_Books")?.kind).toBe("keyword");
  });
});
