// #251 — error steers must name the real cause: FTS parse error / timeout / disabled / busy each get
// their own next step, and update_book maps a missing id to the same message get_book gives.
import { describe, expect, it } from "vitest";
import { searchTool } from "../../src/tools/calibre_search.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { CalibreBusyError, CalibreHttpError, CalibreHttpTimeoutError, FtsError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { SearchDeps, SearchIndex } from "../../src/tools/calibre_search.js";
import { fakeFts } from "./fake-fts.js";

function deps(content: object, calibre: object): SearchDeps {
  return {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async (d?: string) => d || "Programming_Books",
      ...content,
    } as unknown as ToolDeps["content"],
    calibre: calibre satisfies Partial<ToolDeps["calibre"]> as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false, isBookIndexed: () => false } satisfies SearchIndex,
    log,
  };
}

// The FTS port fails the way ContentServerClient maps real /fts/search replies (probed
// 2026-10-31): 428 "Full text searching is not enabled on this library" → FTS_DISABLED,
// 422 "Failed to parse search query: a:b- with error: no such column: a" → FTS_QUERY_INVALID.
const ftsFails = (err: Error): SearchDeps => ({
  ...deps({}, {}),
  fts: fakeFts([], { match: async () => Promise.reject(err) }),
});
const ftsArgs = { query: "LOGTEST-LONG event sourcing", mode: "fts", scope: "library", limit: 20 } as const;
const textOf = (r: { content: { type: string; text?: string }[] }): string =>
  r.content.map((c) => c.text ?? "").join("\n");
const LIB = asLibId("Programming_Books");

describe("calibre_search FTS failure steers (#251)", () => {
  it("steers a parse error to quoting the query, not to enabling indexing", async () => {
    const r = await searchTool.handler(ftsArgs, ftsFails(new FtsError("FTS_QUERY_INVALID", LIB)));
    expect(r.isError).toBe(true);
    const t = textOf(r);
    expect(t).toContain("couldn't parse");
    expect(t).toContain("double quotes");
    expect(t).not.toContain("Enable it in Calibre");
  });

  it("steers FTS-disabled to enabling it in Calibre plus the keyword fallback", async () => {
    const r = await searchTool.handler(ftsArgs, ftsFails(new FtsError("FTS_DISABLED", LIB)));
    expect(r.isError).toBe(true);
    const t = textOf(r);
    expect(t).toContain('not enabled for library "Programming_Books"');
    expect(t).toContain("Enable it in Calibre");
    expect(t).toContain('calibre_semantic_search with mode:"keyword"');
  });

  it("steers a timeout to waiting, narrowing with bookId/filter, and the keyword fallback", async () => {
    const r = await searchTool.handler(ftsArgs, ftsFails(new CalibreHttpTimeoutError("http://x/fts/search")));
    expect(r.isError).toBe(true);
    const t = textOf(r);
    expect(t).toContain("45 s time budget");
    expect(t).toContain("bookId");
    expect(t).toContain("filter");
    expect(t).toContain('mode:"keyword"');
    expect(t).not.toContain("Enable it in Calibre");
  });

  it("passes the busy breaker's retry hint through, with the keyword fallback", async () => {
    const r = await searchTool.handler(ftsArgs, ftsFails(new CalibreBusyError("Programming_Books", 42_000)));
    const t = textOf(r);
    expect(t).toContain("still finishing a previous long request");
    expect(t).toContain("Retry in ~42 s");
    expect(t).toContain('mode:"keyword"');
  });
});

describe("calibre_update_book missing id (#251)", () => {
  it("maps a 404 on the pre-read to the same message as get_book, without raw HTTP text", async () => {
    const d = deps(
      {
        getBook: async () =>
          Promise.reject(new CalibreHttpError(404, "http://x/ajax/book/999999/L", "Content Server returned HTTP 404")),
      },
      { calibredb: async () => ({ stdout: "", stderr: "" }) },
    );
    const r = await updateBookTool.handler({ id: 999999, changes: { tags: ["x"] } }, d);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("No book with id 999999 in the requested library");
    expect(textOf(r)).not.toContain("HTTP");
  });
});
