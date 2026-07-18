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
    expect(cache.get("calibre_search", "rust")?.books).toHaveLength(1);
  });

  it("should_miss_on_unknown_query_instead_of_returning_another_search", () => {
    const cache = new BoardCache();
    cache.set(payload());
    expect(cache.get("calibre_search", "kafka")).toBeUndefined();
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
    expect(cache.get("calibre_search", "rust")?.books).toHaveLength(1);
  });

  it("should_evict_oldest_entry_past_capacity", () => {
    const cache = new BoardCache();
    for (let i = 0; i < 17; i++) cache.set(payload({ query: `q${i}` }));
    expect(cache.get("calibre_search", "q0")).toBeUndefined();
    expect(cache.get("calibre_search", "q16")).toBeDefined();
  });
});
