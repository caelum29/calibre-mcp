// #419: Calibre's FTS5 table has no title/authors columns, so any `col:` operand is a 422.
// The steer must say column filters are unsupported in mode=fts and point at mode=meta.
import { describe, expect, it } from "vitest";
import { searchTool } from "../../src/tools/calibre_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { FtsError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { SearchDeps, SearchIndex } from "../../src/tools/calibre_search.js";
import { fakeFts } from "./fake-fts.js";
import { textOf } from "./text-of.js";

function deps(fts: ToolDeps["fts"]): SearchDeps {
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
    index: { hasIndex: () => false, isBookIndexed: () => false } satisfies SearchIndex,
    log,
  };
}

const rejecting422 = () =>
  fakeFts([], {
    match: async () => Promise.reject(new FtsError("FTS_QUERY_INVALID", asLibId("Programming_Books"))),
  });

describe("calibre_search mode=fts column filters (#419)", () => {
  for (const query of ["title:python NOT java", "{title authors}:clean code", "python NOT title:NEAR(snake charmer)"]) {
    it(`should_steer_to_mode_meta_when_422_follows_a_column_filter: ${query}`, async () => {
      const r = await searchTool.handler({ query, mode: "fts", scope: "library", limit: 20 }, deps(rejecting422()));
      expect(r.isError).toBe(true);
      expect(r.structuredContent?.errorCode).toBe("invalid_input");
      const t = textOf(r);
      expect(t).toContain("column filters are not supported in mode=fts");
      expect(t).toContain("mode=meta");
    });
  }

  it("should_keep_the_generic_syntax_steer_when_there_is_no_column_operand", async () => {
    const r = await searchTool.handler(
      { query: "NOT foo", mode: "fts", scope: "library", limit: 20 },
      deps(rejecting422()),
    );
    expect(textOf(r)).toContain("AND/OR/NOT go between terms");
    expect(textOf(r)).not.toContain("column filters");
  });
});
