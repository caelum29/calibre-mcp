// #655 / ADR-0033 item 2: offsets moved to cleaned coordinates, so CONTENT_CURSOR_VERSION is 3 and a
// cursor minted before the change fails with the actionable error — never a silent restart at 0.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { getContentTool } from "../../src/tools/calibre_get_content.js";
import { CONTENT_CURSOR_VERSION, decodeContentCursor, encodeContentCursor } from "../../src/tools/content-cursor.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "./fake-ports.js";

const v2Cursor = Buffer.from(JSON.stringify({ v: 2, offset: 8000, id: 1, format: "pdf" }), "utf8").toString(
  "base64url",
);

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

let extracted = 0;
const deps: BaseDeps = {
  config: loadConfig({}),
  content: fakeContent({ getBook: async () => book, resolveLibraryId: async () => asLibId("Programming_Books") }),
  calibre: fakeCalibre(),
  extractor: fakeExtractor({
    getText: async () => {
      extracted += 1;
      return {
        text: "x".repeat(20_000),
        backend: "pdftotext",
        chars: 20_000,
        cached: false,
        markers: [],
        unplaced: 0,
        outline: [],
        epubToc: null,
      };
    },
  }),
  figures: fakeFigures(),
  embedder: fakeEmbedder(),
  log,
};

describe("content cursor v3 (#655)", () => {
  it("is version 3 and round-trips", () => {
    expect(CONTENT_CURSOR_VERSION).toBe(3);
    const c = { offset: 120, id: 1, format: "pdf" };
    expect(JSON.parse(Buffer.from(encodeContentCursor(c), "base64url").toString("utf8")).v).toBe(3);
    expect(decodeContentCursor(encodeContentCursor(c))).toEqual(c);
  });

  it("rejects a version-2 cursor (raw-text offsets)", () => {
    expect(decodeContentCursor(v2Cursor)).toBeUndefined();
  });

  it("answers a version-2 cursor with the actionable invalid-cursor error, without reading the book", async () => {
    extracted = 0;
    const r = await getContentTool.handler({ id: 1, maxChars: 8000, sentenceAware: false, cursor: v2Cursor }, deps);
    expect(r.isError).toBe(true);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("Cursors minted before a server upgrade are also invalid");
    expect(text).toContain("offset");
    expect(r.structuredContent?.errorCode).toBe("invalid_input");
    expect(extracted).toBe(0);
  });
});
