import { describe, it, expect } from "vitest";
import { boardDataTool } from "../../src/tools/calibre_board_data.js";
import { BoardCache, type BoardPayload } from "../../src/ui/board-cache.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/types.js";

const payload: BoardPayload = {
  tool: "calibre_search",
  query: "rust",
  kind: "keyword",
  libraryId: "Programming_Books",
  serverUrl: "http://localhost:8080",
  books: [{ bookId: 1, title: "Book 1", authors: ["A"] }],
};

function deps(cache?: BoardCache): ToolDeps {
  return {
    config: loadConfig({}),
    content: {} as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    boardCache: cache,
    log,
  };
}

describe("calibre_board_data handler", () => {
  it("should_return_cached_payload_as_structured_content", async () => {
    const cache = new BoardCache();
    cache.set(payload);
    const r = await boardDataTool.handler({ tool: "calibre_search", query: "rust" }, deps(cache));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ query: "rust", libraryId: "Programming_Books" });
  });

  it("should_error_on_cache_miss", async () => {
    const r = await boardDataTool.handler({ tool: "calibre_search", query: "zzz" }, deps(new BoardCache()));
    expect(r.isError).toBe(true);
  });

  it("should_error_when_cache_not_wired", async () => {
    const r = await boardDataTool.handler({}, deps(undefined));
    expect(r.isError).toBe(true);
  });
});
