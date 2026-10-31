// PR #311 review (#309): the parse-error steer and the description agree on FTS5 syntax —
// AND/OR/NOT are supported binary operators (NOT is `a NOT b`), so only `-`/`:` get dropped —
// and a header query holding a backtick still renders as one code span.
import { describe, expect, it } from "vitest";
import { searchTool } from "../../src/tools/calibre_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { FtsError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { fakeFts, type FakeFtsHit } from "./fake-fts.js";

// Boundary stub: only what the FTS library branch touches.
function deps(fts: ToolDeps["fts"]): ToolDeps {
  return {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async (d?: string) => d || "Programming_Books",
    } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    fts,
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false } as unknown as ToolDeps["index"],
    log,
  };
}

const textOf = (r: { content: { type: string; text?: string }[] }): string =>
  r.content.map((c) => c.text ?? "").join("\n");
const hits: FakeFtsHit[] = [{ bookId: 1, snippet: "x" }];

describe("calibre_search FTS syntax consistency (PR #311 review)", () => {
  it("should_show_binary_NOT_usage_in_the_description", () => {
    expect(searchTool.description).toContain("a NOT b");
  });

  it("should_not_tell_the_model_to_drop_supported_boolean_operators_on_a_parse_error", async () => {
    const failing = fakeFts([], {
      match: async () => Promise.reject(new FtsError("FTS_QUERY_INVALID", asLibId("Programming_Books"))),
    });
    const r = await searchTool.handler({ query: "a:b-", mode: "fts", scope: "library", limit: 20 }, deps(failing));
    const t = textOf(r);
    expect(t).not.toMatch(/drop operators like[^.]*AND/);
  });

  it("should_steer_a_parse_error_to_operator_placement", async () => {
    const failing = fakeFts([], {
      match: async () => Promise.reject(new FtsError("FTS_QUERY_INVALID", asLibId("Programming_Books"))),
    });
    const r = await searchTool.handler({ query: "NOT foo", mode: "fts", scope: "library", limit: 20 }, deps(failing));
    expect(textOf(r)).toContain("AND/OR/NOT go between terms");
  });

  it("should_fence_a_query_with_a_backtick_in_a_double_backtick_span", async () => {
    const r = await searchTool.handler(
      { query: '"a`b"', mode: "fts", scope: "library", limit: 20, countOnly: true },
      deps(fakeFts(hits)),
    );
    expect(textOf(r)).toBe('1 books have full-text matches for `` "a`b" ``.');
  });
});
