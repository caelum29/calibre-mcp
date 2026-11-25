// calibre_get_figures fetch log line (#680): a stable msg with the values in meta, so
// `jq -r .msg | uniq -c` counts one event and every value is queryable as a field.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getFiguresTool } from "../../src/tools/calibre_get_figures.js";
import { loadConfig } from "../../src/config.js";
import type { Book } from "../../src/domain/book.js";
import type { FigureInventory } from "../../src/domain/figures/inventory.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

const inventory: FigureInventory = {
  entries: [
    { index: 0, page: 1, captioned: true, label: "1-1", caption: "A model", source: "raster" },
    { index: 1, page: 5, captioned: true, label: "1-2", caption: "Another", source: "raster" },
  ],
  pageCount: 10,
  scanned: false,
  counts: { figures: 2, uncaptioned: 0, pageRender: 0 },
};

function setup() {
  const infos: { msg: string; meta: unknown }[] = [];
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
  const deps: BaseDeps = {
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
      fetchFigures: async () => ({
        images: [
          { index: 0, image: { data: "AAAA", mimeType: "image/png", bytes: 2048 } },
          { index: 1, image: { data: "BBBB", mimeType: "image/jpeg", bytes: 512 } },
        ],
        skipped: [],
      }),
    } as unknown as ToolDeps["figures"],
    log: {
      debug: () => undefined,
      info: (msg, meta) => void infos.push({ msg, meta }),
      warn: () => undefined,
      error: () => undefined,
    },
  };
  return { deps, infos };
}

describe("calibre_get_figures fetch log (#680)", () => {
  it("should_log_one_stable_msg_per_fetched_figure_with_fields_in_meta", async () => {
    const { deps, infos } = setup();
    await getFiguresTool.handler(z.object(getFiguresTool.inputSchema).parse({ id: 929, indexes: [0, 1] }), deps);
    expect(infos).toEqual([
      {
        msg: "figure fetched",
        meta: { bookId: 929, format: "pdf", index: 0, detail: "standard", mimeType: "image/png", bytes: 2048 },
      },
      {
        msg: "figure fetched",
        meta: { bookId: 929, format: "pdf", index: 1, detail: "standard", mimeType: "image/jpeg", bytes: 512 },
      },
    ]);
  });
});
