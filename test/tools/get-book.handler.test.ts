// calibre_get_book: include_cover opt-in (issue #22) + the widget plumbing fields.

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getBookTool } from "../../src/tools/calibre_get_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ToolDeps } from "../../src/tools/types.js";

const book: Book = {
  id: 7,
  uuid: "u-7",
  title: "Designing Data-Intensive Applications",
  authors: ["Martin Kleppmann"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: ["eng"],
};

function deps(thumb: { data: string; mimeType: string } | null): ToolDeps {
  return {
    config: loadConfig({}),
    content: {
      getBook: async () => book,
      resolveLibraryId: async () => "Programming_Books",
      coverThumb: async () => thumb,
    } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    log,
  };
}

const args = (over: Record<string, unknown> = {}) =>
  z.object(getBookTool.inputSchema).parse({ id: 7, ...over });

describe("calibre_get_book include_cover", () => {
  it("should_coerce_string_false_to_false", () => {
    expect(args({ include_cover: "false" }).include_cover).toBe(false);
  });

  it("should_default_to_false_when_omitted", () => {
    expect(args().include_cover).toBe(false);
  });

  it("should_omit_image_block_by_default", async () => {
    const r = await getBookTool.handler(args(), deps({ data: "QUJD", mimeType: "image/jpeg" }));
    expect(r.content.some((c) => c.type === "image")).toBe(false);
  });

  it("should_attach_image_block_when_opted_in", async () => {
    const r = await getBookTool.handler(
      args({ include_cover: true }),
      deps({ data: "QUJD", mimeType: "image/jpeg" }),
    );
    const img = r.content.find((c) => c.type === "image");
    expect(img).toMatchObject({ data: "QUJD", mimeType: "image/jpeg" });
  });

  it("should_degrade_with_note_when_cover_missing", async () => {
    const r = await getBookTool.handler(args({ include_cover: true }), deps(null));
    expect(r.isError).toBeFalsy();
    expect(r.content.some((c) => c.type === "image")).toBe(false);
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect((r.content[0] as { text: string }).text).toContain("No cover image");
  });

  it("should_expose_server_url_and_library_id_for_the_card_widget", async () => {
    const r = await getBookTool.handler(args(), deps(null));
    expect(r.structuredContent).toMatchObject({
      serverUrl: "http://localhost:8080",
      libraryId: "Programming_Books",
    });
  });
});

describe("calibre_get_book text summary (#104)", () => {
  it("should_mirror_formats_ids_and_catalog_fields_before_comments", async () => {
    const full: Book = {
      ...book,
      identifiers: { isbn: "9781098184579", google: "abc" },
      formats: ["epub", "pdf"],
      tags: ["databases", "ai"],
      series: "Data",
      seriesIndex: 2,
      publisher: "O'Reilly",
      pubdate: "2026-01-15T00:00:00+00:00",
      pages: 312,
      comments: "<p>About vectors</p>",
      lastModified: "2026-02-01T10:00:00+00:00",
    };
    const d = deps(null);
    d.content.getBook = async () => full;
    const r = await getBookTool.handler(args(), d);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("formats: EPUB, PDF | pages: 312 | lang: eng");
    expect(text).toContain("isbn: 9781098184579 | ids: google:abc");
    expect(text).toContain("series: Data [2] | tags: databases, ai | publisher: O'Reilly | pubdate: 2026-01-15");
    expect(text).toContain("id: 7 | uuid: u-7 | last modified: 2026-02-01T10:00:00+00:00");
    expect(text.indexOf("formats:")).toBeLessThan(text.indexOf("About vectors"));
  });

  it("should_show_dashes_for_empty_fields_and_hide_the_date_sentinel", async () => {
    const d = deps(null);
    d.content.getBook = async () => ({ ...book, pubdate: "0101-01-01T00:00:00+00:00" });
    const r = await getBookTool.handler(args(), d);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("isbn: — | ids: —");
    expect(text).toContain("series: — | tags: — | publisher: — | pubdate: —");
  });
});
