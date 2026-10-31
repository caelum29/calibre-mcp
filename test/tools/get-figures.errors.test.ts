// calibre_get_figures error wording (#220): a typed FiguresError drives one code→message map,
// and the model-visible text stays byte-identical to the old "FIGURES_*" string switch.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getFiguresTool } from "../../src/tools/calibre_get_figures.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { FiguresError } from "../../src/domain/errors.js";
import type { Book } from "../../src/domain/book.js";
import type { FigureInventory } from "../../src/domain/figures/inventory.js";
import type { ToolDeps } from "../../src/tools/types.js";

const inventory: FigureInventory = {
  entries: [{ index: 0, page: 1, captioned: true, label: "1-1", caption: "A model", source: "raster" }],
  pageCount: 10,
  scanned: false,
  counts: { figures: 1, uncaptioned: 0, pageRender: 0 },
};

const book: Book = {
  id: 929,
  uuid: "u",
  title: "T",
  authors: [],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
};

function deps(figures: unknown): ToolDeps {
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
    figures: figures as ToolDeps["figures"],
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => z.object(getFiguresTool.inputSchema).parse({ id: 929, ...over });
const textOf = (r: { content: Array<{ type: string }> }) => (r.content[0] as unknown as { text: string }).text;

describe("FiguresError", () => {
  it("should_carry_its_code_and_stay_an_Error", () => {
    const err = new FiguresError("NO_POPPLER");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("NO_POPPLER");
    expect(err.name).toBe("FiguresError");
  });
});

describe("calibre_get_figures scan failures", () => {
  const cases: Array<[ConstructorParameters<typeof FiguresError>[0], string]> = [
    [
      "NO_POPPLER",
      "No poppler tools found (pdfimages/pdftotext) — install with `brew install poppler` to scan PDF figures.",
    ],
    ["NO_UNZIP", "No unzip binary found — needed to scan EPUB figures."],
    ["FORMAT_UNSUPPORTED", "Figures need an EPUB or PDF source; pdf is not supported."],
    ["SCAN_TIMEOUT", "Figure scan timed out for book 929 (pdf) — the file may be very large."],
    ["SCAN_FAILED", "Could not scan book 929 (pdf) for figures — the file may be DRM-protected or corrupt."],
    ["FETCH_FAILED", "FIGURES_FETCH_FAILED"],
  ];
  for (const [code, text] of cases) {
    it(`should_say_exactly_this_for_${code}`, async () => {
      const figures = {
        getInventory: async () => {
          throw new FiguresError(code);
        },
      };
      const r = await getFiguresTool.handler(args(), deps(figures));
      expect(r.isError).toBe(true);
      expect(textOf(r)).toBe(text);
    });
  }
});

describe("calibre_get_figures skipped figures", () => {
  const skippedText = async (skipped: unknown[]) => {
    const figures = {
      getInventory: async () => ({ inventory }),
      fetchFigures: async () => ({ images: [], skipped }),
    };
    const r = await getFiguresTool.handler(args({ indexes: [0] }), deps(figures));
    return r.content.map((b) => (b as unknown as { text: string }).text);
  };

  it("should_explain_a_missing_poppler", async () => {
    expect(await skippedText([{ index: 0, code: "NO_POPPLER" }])).toContain(
      "Figure index 0 skipped: poppler is missing (brew install poppler) — needed to extract PDF figures.",
    );
  });

  it("should_explain_a_missing_qlmanage", async () => {
    expect(await skippedText([{ index: 0, code: "NO_QLMANAGE" }])).toContain(
      "Figure index 0 skipped: this SVG figure needs macOS qlmanage to rasterize, which is unavailable here.",
    );
  });

  it("should_explain_a_failed_extraction", async () => {
    expect(await skippedText([{ index: 0, code: "FETCH_FAILED" }])).toContain(
      "Figure index 0 skipped: the image could not be extracted from the source file.",
    );
  });

  it("should_pass_prose_reasons_through_and_leave_uncoded_codes_raw", async () => {
    const texts = await skippedText([
      { index: 0, reason: "no such figure index" },
      { index: 0, code: "NO_UNZIP" },
    ]);
    expect(texts).toContain("Figure index 0 skipped: no such figure index");
    expect(texts).toContain("Figure index 0 skipped: FIGURES_NO_UNZIP");
  });
});
