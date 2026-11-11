// #553: an EPUB figure's number is the spine-section index, not a page — EPUB rows carry
// `section` shown as `§N`; PDF rows keep `page` / `p.N` exactly as before.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getFiguresTool } from "../../src/tools/calibre_get_figures.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { FigureInventory } from "../../src/domain/figures/inventory.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

const inventory: FigureInventory = {
  entries: [
    { index: 0, page: 5, captioned: true, label: "1-1", caption: "A model", source: "raster" },
    { index: 1, page: 6, captioned: true, label: "2-1", caption: "Another", source: "raster" },
  ],
  pageCount: 10,
  scanned: false,
  counts: { figures: 2, uncaptioned: 0, pageRender: 0 },
};

function deps(formats: string[]): BaseDeps {
  const book: Book = {
    id: 929,
    uuid: "u",
    title: "T",
    authors: [],
    identifiers: {},
    formats,
    tags: [],
    languages: [],
  };
  return {
    config: loadConfig({}),
    content: {
      getBook: async () => book,
      resolveLibraryId: async () => "Programming_Books",
    } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    embedder: {} as ToolDeps["embedder"],
    figures: {
      getInventory: async () => ({ inventory }),
      // no image block keeps structuredContent on the result; the text line is the same either way
      fetchFigures: async () => ({
        images: [{ index: 0, image: { data: "AAAA", mimeType: "image/png", bytes: 2048 } }],
        skipped: [],
      }),
    } as unknown as ToolDeps["figures"],
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => z.object(getFiguresTool.inputSchema).parse({ id: 929, ...over });
const texts = (r: { content: Array<{ type: string; text?: string }> }) =>
  r.content.filter((b) => b.type === "text").map((b) => b.text ?? "");

describe("calibre_get_figures EPUB section vs PDF page (#553)", () => {
  it("should_label_epub_list_rows_with_the_section_sign", async () => {
    const r = await getFiguresTool.handler(args(), deps(["epub"]));
    const text = texts(r)[0]!;
    expect(text).toContain(
      "index | section | source | caption\n0 | §5 | raster 1-1 | A model\n1 | §6 | raster 2-1 | Another",
    );
  });

  it("should_carry_no_page_label_on_any_epub_list_row", async () => {
    const r = await getFiguresTool.handler(args(), deps(["epub"]));
    expect(texts(r)[0]).not.toMatch(/\bp\.\d/);
  });

  it("should_put_section_and_no_page_in_epub_structured_entries", async () => {
    const r = await getFiguresTool.handler(args(), deps(["epub"]));
    const entries = r.structuredContent?.entries as Array<Record<string, unknown>>;
    expect(entries.map((e) => [e.section, "page" in e])).toEqual([
      [5, false],
      [6, false],
    ]);
  });

  it("should_keep_pdf_list_rows_and_entries_unchanged", async () => {
    const r = await getFiguresTool.handler(args(), deps(["pdf"]));
    expect(texts(r)[0]).toContain("index | page | source | caption\n0 | p.5 | raster 1-1 | A model");
    const entries = r.structuredContent?.entries as Array<Record<string, unknown>>;
    expect(entries.map((e) => [e.page, "section" in e])).toEqual([
      [5, false],
      [6, false],
    ]);
  });

  it("should_show_the_section_in_the_epub_figure_index_line", async () => {
    const r = await getFiguresTool.handler(args({ indexes: [0] }), deps(["epub"]));
    expect(texts(r)).toContain("Figure index 0 (§5, raster, image/png 2.0 KB) — Figure 1-1: A model");
  });

  it("should_keep_the_pdf_figure_index_line_unchanged", async () => {
    const r = await getFiguresTool.handler(args({ indexes: [0] }), deps(["pdf"]));
    expect(texts(r)).toContain("Figure index 0 (p.5, raster, image/png 2.0 KB) — Figure 1-1: A model");
  });
});
