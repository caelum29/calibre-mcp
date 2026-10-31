// #325 §Cursors review: null / "" / true / [] cursors. Clients send `cursor: null` (or "") for an
// unset optional param, so both must mean "no cursor" on every tool; other junk is stringified and
// answered with the actionable invalid-cursor error, never -32602.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CursorParam } from "../../src/tools/coerce.js";
import { decodeCursor, encodeCursor } from "../../src/tools/cursor.js";
import { getContentTool } from "../../src/tools/calibre_get_content.js";
import { listCategoriesTool } from "../../src/tools/calibre_list_categories.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import type { ToolDeps } from "../../src/tools/deps.js";

describe("CursorParam null / empty / junk (#325)", () => {
  it.each([[null], [""]])("%j means no cursor", (v) => {
    expect(CursorParam.parse(v)).toBeUndefined();
  });
  it("stringifies true and []", () => {
    expect(CursorParam.parse(true)).toBe("true");
    expect(CursorParam.parse([])).toBe("[]");
  });
});

const book: Book = {
  id: 1,
  uuid: "u-1",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
};

const deps = {
  config: loadConfig({}),
  content: {
    getBook: async () => book,
    resolveLibraryId: async () => "Lib",
    categories: async () => [{ name: "Tags", url: "/ajax/category/ttt/Lib" }],
    search: async () => ({ bookIds: [], total: 0, num: 0, offset: 0, sort: "title", libraryId: "Lib" }),
    booksByIds: async () => new Map(),
  } as unknown as ToolDeps["content"],
  calibre: {} as ToolDeps["calibre"],
  extractor: {
    getText: async () => ({
      text: "x".repeat(20_000),
      backend: "pdftotext",
      chars: 20_000,
      cached: false,
      markers: [],
      unplaced: 0,
      outline: [],
      epubToc: null,
    }),
  } as unknown as ToolDeps["extractor"],
  figures: {} as ToolDeps["figures"],
  embedder: {} as ToolDeps["embedder"],
  index: {} as ToolDeps["index"],
  log,
} satisfies ToolDeps;

const content = (raw: Record<string, unknown>) =>
  getContentTool.handler(z.object(getContentTool.inputSchema).parse({ id: 1, sentenceAware: false, ...raw }), deps);

describe("get_content with null / empty cursor (#325)", () => {
  it.each([[null], [""]])("cursor %j alone reads the first page", async (cursor) => {
    const r = await content({ cursor });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ offset: 0, hasMore: true });
  });

  it.each([[null], [""]])("cursor %j + offset 5000 is not 'both'", async (cursor) => {
    const r = await content({ cursor, offset: 5000 });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ offset: 5000 });
  });

  it("cursor true is the actionable invalid-cursor error", async () => {
    const r = await content({ cursor: true });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ errorCode: "invalid_input" });
    expect(String(r.structuredContent?.error)).toMatch(/^Invalid cursor — pass the exact nextCursor/);
  });
});

describe("list_categories with null / empty / junk cursor (#325)", () => {
  const list = (raw: Record<string, unknown>) =>
    listCategoriesTool.handler(z.object(listCategoriesTool.inputSchema).parse(raw), deps);

  it.each([[null], [""]])("cursor %j lists the fields", async (cursor) => {
    const r = await list({ cursor });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ mode: "fields" });
  });

  it.each([[true], [[]]])("cursor %j is refused as an invalid cursor", async (cursor) => {
    const r = await list({ cursor });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ errorCode: "invalid_input" });
    expect(String(r.structuredContent?.error)).toMatch(/^Invalid cursor for calibre_list_categories/);
  });
});

describe("quality_report with null / empty cursor (#325)", () => {
  it.each([[null], [""]])("cursor %j starts at page 0", async (cursor) => {
    const r = await qualityReportTool.handler(z.object(qualityReportTool.inputSchema).parse({ cursor }), deps);
    expect(r.isError).toBeFalsy();
  });
});

describe("decodeCursor rejects a v2 token missing a field (#325)", () => {
  const full = { offset: 2, libId: "Lib", mode: "m", query: "q" };
  it("round-trips the full token", () => {
    expect(decodeCursor(encodeCursor(full))).toEqual({ ...full, sort: undefined });
  });
  it.each(["offset", "libId", "mode", "query"] as const)("missing %s → undefined", (field) => {
    const { [field]: _omit, ...rest } = full;
    const token = Buffer.from(JSON.stringify({ v: 2, ...rest }), "utf8").toString("base64url");
    expect(decodeCursor(token)).toBeUndefined();
  });
});
