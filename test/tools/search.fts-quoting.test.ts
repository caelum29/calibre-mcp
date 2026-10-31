// Issue #309: FTS phrase syntax documented in the tool description; result headers never
// double-quote an already-quoted query (`""event sourcing""`).
import { describe, it, expect } from "vitest";
import { searchTool } from "../../src/tools/calibre_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { fakeFts, type FakeFtsHit } from "./fake-fts.js";
import type { ToolDeps, ToolResult } from "../../src/tools/types.js";

// Boundary stub: only what the FTS branches touch.
function deps(ftsHits: FakeFtsHit[]): ToolDeps {
  const content = { resolveLibraryId: async (display?: string) => display || "Programming_Books" };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    fts: fakeFts(ftsHits),
    extractor: {} as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false } as unknown as ToolDeps["index"],
    log,
  };
}

const header = (r: ToolResult): string => {
  const first = r.content[0];
  if (first?.type !== "text") throw new Error("first block is not text");
  return first.text;
};

const hits: FakeFtsHit[] = [{ bookId: 1, snippet: "event sourcing here" }];

describe("calibre_search description — FTS syntax (#309)", () => {
  it("should_tell_the_model_to_quote_phrases", () => {
    expect(searchTool.description).toContain("wrap a phrase in double quotes");
  });

  it("should_mention_stemming", () => {
    expect(searchTool.description).toMatch(/stemmed/);
  });

  it("should_list_the_boolean_operators_calibre_accepts", () => {
    expect(searchTool.description).toContain("AND/OR/NOT");
  });
});

describe("calibre_search FTS headers — no doubled quotes (#309)", () => {
  it("should_show_a_quoted_query_once_quoted_in_the_library_header", async () => {
    const r = await searchTool.handler(
      { query: '"event sourcing"', mode: "fts", scope: "library", limit: 20 },
      deps(hits),
    );
    expect(header(r)).toContain('full-text matches for `"event sourcing"`, showing 1–1.');
  });

  it("should_keep_plain_double_quotes_for_an_unquoted_query", async () => {
    const r = await searchTool.handler(
      { query: "event sourcing", mode: "fts", scope: "library", limit: 20 },
      deps(hits),
    );
    expect(header(r)).toContain('full-text matches for "event sourcing", showing 1–1.');
  });

  it("should_not_double_quote_in_the_zero_result_header", async () => {
    const r = await searchTool.handler(
      { query: '"no such phrase"', mode: "fts", scope: "library", limit: 20 },
      deps([]),
    );
    expect(header(r)).toBe('0 full-text matches for `"no such phrase"`.');
  });

  it("should_not_double_quote_in_the_count_only_header", async () => {
    const r = await searchTool.handler(
      { query: '"event sourcing"', mode: "fts", scope: "library", limit: 20, countOnly: true },
      deps(hits),
    );
    expect(header(r)).toBe('1 books have full-text matches for `"event sourcing"`.');
  });

  it("should_not_double_quote_a_boolean_query_with_inner_phrases", async () => {
    const r = await searchTool.handler(
      { query: '"event sourcing" OR cqrs', mode: "fts", scope: "library", limit: 20, countOnly: true },
      deps(hits),
    );
    expect(header(r)).toBe('1 books have full-text matches for `"event sourcing" OR cqrs`.');
  });

  it("should_not_double_quote_in_the_book_scope_header", async () => {
    const r = await searchTool.handler(
      { query: '"event sourcing"', mode: "fts", scope: "book", bookId: 1, limit: 20 },
      deps(hits),
    );
    expect(header(r)).toContain('in-book matches for `"event sourcing"` in book 1');
  });
});
