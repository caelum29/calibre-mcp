// #519: a whole-book annotation listing (scope=book, query "*") carries the book's title, looked up
// once per call; `annotations export` rows have none. Fixture is a real capture (#500).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { log } from "../../src/logging.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { SearchDeps } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const FIX = path.join(import.meta.dirname, "../calibre/fixtures/annotations-notes-500");
const exportRaw = readFileSync(path.join(FIX, "annotations-export.raw"), "utf8");

function deps(getBook: (id: number) => Promise<{ title: string }>) {
  invalidateBundleCache();
  const lookups: number[] = [];
  const d = {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      virtualLibraries: async () => ({}),
      getBook: async (id: number) => {
        lookups.push(id);
        return getBook(id);
      },
    } as unknown as ToolDeps["content"],
    calibre: {
      calibreVersion: async () => parseCalibreVersion("calibredb (calibre 9.18)"),
      calibredb: async (args: readonly string[]) =>
        args[0] === "saved_searches"
          ? { stdout: "Integration status: False\n", stderr: "" }
          : { stdout: exportRaw, stderr: "" },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  } as unknown as SearchDeps;
  return { d, lookups };
}

const textOf = (r: ToolResult) => r.content.map((b) => ("text" in b ? b.text : "")).join("\n");
const sc = (r: ToolResult) => r.structuredContent as Record<string, unknown>;
const run = (d: SearchDeps) =>
  searchTool.handler({ query: "*", mode: "annotations", scope: "book", bookId: 644, limit: 20 } as never, d as never);

describe("whole-book annotations fill the title from the book (#519)", () => {
  it("should_print_the_title_in_the_header_line_of_the_books_records", async () => {
    const r = await run(deps(async () => ({ title: "Event Streams" })).d);
    expect(textOf(r)).toContain("annotation · highlight · book 644 · EPUB · Event Streams");
  });

  it("should_fill_the_title_field_of_the_structured_records_of_that_book", async () => {
    const r = await run(deps(async () => ({ title: "Event Streams" })).d);
    const list = sc(r).annotations as Array<{ bookId: number; title?: string }>;
    // the real capture mixes in rows of book 94: only the requested book's rows get its title
    expect(list.map((a) => [a.bookId, a.title])).toEqual(
      list.map((a) => [a.bookId, a.bookId === 644 ? "Event Streams" : undefined]),
    );
    expect(list.filter((a) => a.bookId === 644).length).toBe(9);
  });

  it("should_look_the_title_up_once_per_call", async () => {
    const f = deps(async () => ({ title: "Event Streams" }));
    await run(f.d);
    expect(f.lookups).toEqual([644]);
  });

  it("should_succeed_without_a_title_when_the_lookup_fails", async () => {
    const r = await run(
      deps(async () => {
        throw new Error("content server down");
      }).d,
    );
    expect({ error: r.isError, total: sc(r).total, text: textOf(r).includes("book 644 · EPUB\n") }).toEqual({
      error: undefined,
      total: 17,
      text: true,
    });
  });
});
