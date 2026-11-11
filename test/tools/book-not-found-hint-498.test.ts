// Book-not-found steer (#498): the error names ONE next step, once, in the text (`Next:`)
// and in structuredContent.hint — for bookNotFound and the `No book with id/uuid` variants.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { bookNotFound } from "../../src/tools/result.js";
import { extractIsbnTool } from "../../src/tools/calibre_extract_isbn.js";
import { recoverMetadataTool } from "../../src/tools/calibre_recover_metadata.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { SearchDeps } from "../../src/tools/calibre_search.js";
import { fakeFts } from "./fake-fts.js";
import { textOf } from "./text-of.js";

const HINT =
  "Find the book's id with calibre_search, or check calibre_list_libraries — the id may belong to another library.";

// uuid lookups answer with no hit → resolveNumericId returns undefined
const deps = (): SearchDeps => ({
  config: loadConfig({}),
  content: {
    resolveLibraryId: async (d?: string) => d || "Programming_Books",
    search: async () => ({ bookIds: [], total: 0 }),
  } as unknown as ToolDeps["content"],
  calibre: {} as ToolDeps["calibre"],
  extractor: {} as ToolDeps["extractor"],
  figures: {} as ToolDeps["figures"],
  embedder: {} as ToolDeps["embedder"],
  index: { hasIndex: () => false, isBookIndexed: () => false },
  fts: fakeFts([]),
  log,
});

const parse = <S extends z.ZodRawShape>(shape: S, v: Record<string, unknown>) => z.object(shape).parse(v);

function expectSteer(r: { isError?: boolean; structuredContent?: Record<string, unknown> }, message: string) {
  const t = textOf(r as never);
  expect(r.isError).toBe(true);
  expect(t).toBe(`Error: ${message}\nCode: not_found\nNext: ${HINT}`);
  expect(r.structuredContent).toMatchObject({ error: message, errorCode: "not_found", hint: HINT });
}

describe("book not found names one next step (#498)", () => {
  it("bookNotFound: text and structuredContent.hint", () => {
    expectSteer(bookNotFound(999999999), "No book with id 999999999 in the requested library");
  });

  it("calibre_update_book: id/uuid variant", async () => {
    const r = await updateBookTool.handler(
      parse(updateBookTool.inputSchema, { id: "u-1", changes: { tags: ["x"] } }),
      deps(),
    );
    expectSteer(r, "No book with id/uuid u-1");
  });

  it("calibre_extract_isbn: id/uuid variant", async () => {
    const r = await extractIsbnTool.handler(parse(extractIsbnTool.inputSchema, { id: "u-2" }), deps());
    expectSteer(r, "No book with id/uuid u-2");
  });

  it("calibre_recover_metadata: id/uuid variant", async () => {
    const r = await recoverMetadataTool.handler(parse(recoverMetadataTool.inputSchema, { id: "u-3" }), deps());
    expectSteer(r, "No book with id/uuid u-3");
  });

  it("calibre_search scope=book: id/uuid variant", async () => {
    const r = await searchTool.handler(
      parse(searchTool.inputSchema, { query: "x", mode: "fts", scope: "book", bookId: "u-4" }),
      deps(),
    );
    expectSteer(r, "No book with id/uuid u-4");
  });
});
