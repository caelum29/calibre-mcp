// calibre_get_figures list header: names the other figure-capable format (#106) and spells
// out captioned + uncaptioned = rows when uncaptioned images are shown (#108); list rows
// never cut or blank a caption silently (#107).

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getFiguresTool } from "../../src/tools/calibre_get_figures.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { FigureInventory } from "../../src/domain/figures/inventory.js";
import type { ToolDeps } from "../../src/tools/types.js";

const inventory: FigureInventory = {
  entries: [
    { index: 0, page: 1, captioned: false, source: "raster" },
    { index: 1, page: 5, captioned: true, label: "1-1", caption: "A model", source: "raster" },
    { index: 2, page: 7, captioned: true, label: "1-2", caption: "Another", source: "raster" },
  ],
  pageCount: 10,
  scanned: false,
  counts: { figures: 2, uncaptioned: 1, pageRender: 0 },
};

function deps(formats: string[], inv: FigureInventory = inventory): ToolDeps {
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
    index: {} as ToolDeps["index"],
    figures: { getInventory: async () => ({ inventory: inv }) } as unknown as ToolDeps["figures"],
    log,
  };
}

const args = (over: Record<string, unknown> = {}) =>
  z.object(getFiguresTool.inputSchema).parse({ id: 929, ...over });

const textOf = (r: { content: Array<{ type: string }> }) => (r.content[0] as unknown as { text: string }).text;

describe("calibre_get_figures list header", () => {
  it("should_name_the_other_figure_format_when_the_book_has_both", async () => {
    const r = await getFiguresTool.handler(args(), deps(["epub", "pdf", "mobi"]));
    expect(textOf(r)).toContain('Also has: pdf — pass format:"pdf" to re-list; indexes are per-format.');
  });

  it("should_name_epub_when_pdf_was_requested", async () => {
    const r = await getFiguresTool.handler(args({ format: "pdf" }), deps(["epub", "pdf"]));
    expect(textOf(r)).toContain('Also has: epub — pass format:"epub"');
  });

  it("should_omit_the_hint_for_a_single_figure_format", async () => {
    const r = await getFiguresTool.handler(args(), deps(["epub", "mobi"]));
    expect(textOf(r)).not.toContain("Also has");
  });

  it("should_spell_out_row_arithmetic_with_include_uncaptioned", async () => {
    const r = await getFiguresTool.handler(args({ include_uncaptioned: true }), deps(["epub"]));
    expect(textOf(r)).toContain("Book 929 — 2 captioned figures + 1 uncaptioned image = 3 rows in epub");
  });

  it("should_keep_the_hidden_count_wording_by_default", async () => {
    const r = await getFiguresTool.handler(args(), deps(["epub"]));
    expect(textOf(r)).toContain("Book 929 — 2 figures in epub (1 uncaptioned images hidden");
  });
});

describe("calibre_get_figures list rows (#107)", () => {
  const long = "A".repeat(150);
  const rows: FigureInventory = {
    entries: [
      { index: 0, page: 3, captioned: true, label: "7.2", caption: "", source: "page-render" },
      { index: 1, page: 4, captioned: true, label: "7.3", caption: long, source: "page-render" },
    ],
    pageCount: 10,
    scanned: false,
    counts: { figures: 2, uncaptioned: 0, pageRender: 2 },
  };

  it("should_say_label_only_instead_of_a_blank_caption", async () => {
    const r = await getFiguresTool.handler(args(), deps(["pdf"], rows));
    expect(textOf(r)).toContain("0 | p.3 | page-render 7.2 | (label only — no caption text)");
  });

  it("should_mark_a_clipped_caption_with_an_ellipsis", async () => {
    const r = await getFiguresTool.handler(args(), deps(["pdf"], rows));
    expect(textOf(r)).toContain(`1 | p.4 | page-render 7.3 | ${"A".repeat(99)}…`);
  });
});
