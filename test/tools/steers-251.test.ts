// #251 — error steers must name the real cause: FTS parse error / timeout / not-indexed each get
// their own next step, and update_book maps a missing id to the same message get_book gives.
import { describe, expect, it } from "vitest";
import { searchTool } from "../../src/tools/calibre_search.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { CalibreCliError, CalibreCliTimeoutError, CalibreHttpError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/types.js";

function deps(content: object, calibre: object): ToolDeps {
  return {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async (d?: string) => d || "Programming_Books",
      ...content,
    } as unknown as ToolDeps["content"],
    calibre: calibre as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false } as unknown as ToolDeps["index"],
    log,
  };
}

const ftsFails = (err: Error): ToolDeps => deps({}, { ftsSearch: async () => Promise.reject(err) });
const ftsArgs = { query: "LOGTEST-LONG event sourcing", mode: "fts", scope: "library", limit: 20 } as const;
const textOf = (r: { content: { type: string; text?: string }[] }): string =>
  r.content.map((c) => c.text ?? "").join("\n");

describe("calibre_search FTS failure steers (#251)", () => {
  it("steers a parse error to quoting the query, not to enabling indexing", async () => {
    const diag =
      "Integration status: False\n\nFailed to parse search query: LOGTEST-LONG event sourcing with error: no such column: LONG\n";
    const r = await searchTool.handler(ftsArgs, ftsFails(new CalibreCliError(1, "calibredb command failed", diag)));
    expect(r.isError).toBe(true);
    const t = textOf(r);
    expect(t).toContain("couldn't parse");
    expect(t).toContain("double quotes");
    expect(t).not.toContain("Enable indexing");
  });

  it("treats an fts5 syntax error as a parse error too", async () => {
    const diag = 'Failed to parse search query: foo AND with error: fts5: syntax error near ""\n';
    const r = await searchTool.handler(ftsArgs, ftsFails(new CalibreCliError(1, "calibredb command failed", diag)));
    expect(textOf(r)).toContain("double quotes");
    expect(textOf(r)).not.toContain("Enable indexing");
  });

  it("steers a timeout to one retry, then narrowing with bookId/filter", async () => {
    const r = await searchTool.handler(ftsArgs, ftsFails(new CalibreCliTimeoutError("calibredb command timed out")));
    expect(r.isError).toBe(true);
    const t = textOf(r);
    expect(t).toContain("timed out");
    expect(t).toContain("retry once");
    expect(t).toContain("bookId");
    expect(t).toContain("filter");
    expect(t).not.toContain("Enable indexing");
  });

  it("keeps the enable-indexing steer for any other calibredb failure", async () => {
    const diag = "Integration status: False\n\nFull text search is not enabled\n";
    const r = await searchTool.handler(ftsArgs, ftsFails(new CalibreCliError(1, "calibredb command failed", diag)));
    expect(textOf(r)).toContain("Enable indexing in Calibre");
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
