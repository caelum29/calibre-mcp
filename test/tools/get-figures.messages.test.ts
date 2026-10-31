// calibre_get_figures wording for the codes the first suite leaves out (#220): scan-path
// NO_QLMANAGE and skipped-path SCAN_TIMEOUT / SCAN_FAILED / FORMAT_UNSUPPORTED, exact strings.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getFiguresTool } from "../../src/tools/calibre_get_figures.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { FiguresError } from "../../src/domain/errors.js";
import type { Book } from "../../src/domain/book.js";
import type { FigureInventory } from "../../src/domain/figures/inventory.js";
import type { ToolDeps } from "../../src/tools/deps.js";

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

const deps = (figures: unknown): ToolDeps =>
  ({
    config: loadConfig({}),
    content: { getBook: async () => book, resolveLibraryId: async () => "Programming_Books" },
    calibre: {},
    extractor: {},
    embedder: {},
    index: {},
    figures,
    log,
  }) as unknown as ToolDeps;

const args = (over: Record<string, unknown> = {}) => z.object(getFiguresTool.inputSchema).parse({ id: 929, ...over });
const texts = (r: { content: Array<{ type: string }> }) =>
  r.content.map((b) => (b as unknown as { text: string }).text);

describe("calibre_get_figures remaining code wording", () => {
  it("should_leave_the_raw_code_when_the_scan_hits_NO_QLMANAGE", async () => {
    const figures = {
      getInventory: async () => {
        throw new FiguresError("NO_QLMANAGE");
      },
    };
    const r = await getFiguresTool.handler(args(), deps(figures));
    expect(texts(r)[0]).toBe("Error: FIGURES_NO_QLMANAGE");
  });

  for (const code of ["SCAN_TIMEOUT", "SCAN_FAILED", "FORMAT_UNSUPPORTED"] as const) {
    it(`should_leave_the_raw_code_when_a_skipped_figure_is_${code}`, async () => {
      const figures = {
        getInventory: async () => ({ inventory }),
        fetchFigures: async () => ({ images: [], skipped: [{ index: 0, code }] }),
      };
      const r = await getFiguresTool.handler(args({ indexes: [0] }), deps(figures));
      expect(texts(r)).toContain(`Figure index 0 skipped: FIGURES_${code}`);
    });
  }
});
