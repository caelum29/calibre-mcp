// calibre_get_figures live test (#79 acceptance) — GATED behind RUN_CALIBRE_TESTS=1,
// runs against the RUNNING Content Server (GUI open is the production condition).
// Read-only: downloads book files, never writes to the library. Probe books:
// Software Architecture Metrics (PDF, 66 figures incl. rasters) and Learning DDD
// (EPUB, 133 figures). Skips (not fails) when the server or books are absent.
//
//   RUN_CALIBRE_TESTS=1 pnpm vitest run test/integration/figures.live.test.ts

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { FigureInventoryService } from "../../src/calibre/figure-inventory.js";
import { log } from "../../src/logging.js";
import { getFiguresTool } from "../../src/tools/calibre_get_figures.js";
import type { ImageBlock, TextBlock, ToolDeps, ToolResult } from "../../src/tools/types.js";

const RUN = process.env.RUN_CALIBRE_TESTS === "1";
const PDF_BOOK = 164; // Software Architecture Metrics
const EPUB_BOOK = 755; // Learning Domain-Driven Design

const config = loadConfig(process.env as Record<string, string | undefined>);

let ready = false;
if (RUN) {
  try {
    const probe = async (id: number) =>
      (await fetch(`${config.serverUrl}/ajax/book/${id}/Programming_Books`, {
        signal: AbortSignal.timeout(3_000),
      })).ok;
    ready = (await probe(PDF_BOOK)) && (await probe(EPUB_BOOK));
  } catch {
    ready = false;
  }
}
if (RUN && !ready) {
  // eslint-disable-next-line no-console
  console.error(`[figures.live] Content Server/probe books not reachable at ${config.serverUrl} — skipping`);
}

const images = (r: ToolResult) => r.content.filter((b): b is ImageBlock => b.type === "image");
const texts = (r: ToolResult) => r.content.filter((b): b is TextBlock => b.type === "text");

describe.skipIf(!RUN || !ready)("calibre_get_figures (live Content Server)", () => {
  const deps = {
    config,
    content: new ContentServerClient(config),
    figures: new FigureInventoryService(config),
    log,
  } as ToolDeps;

  it("lists PDF figures with captions and counts", { timeout: 180_000 }, async () => {
    const r = await getFiguresTool.handler({ id: PDF_BOOK, detail: "standard", include_uncaptioned: false }, deps);
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as { format: string; counts: { figures: number }; entries: Array<{ caption?: string }> };
    expect(s.format).toBe("pdf");
    expect(s.counts.figures).toBeGreaterThan(50);
    expect(s.entries.some((e) => e.caption && e.caption.length > 5)).toBe(true);
    expect(texts(r)[0]?.text).toContain("figures in pdf");
  });

  it("fetches a PDF raster figure as an image block", { timeout: 180_000 }, async () => {
    const list = await getFiguresTool.handler({ id: PDF_BOOK, detail: "standard", include_uncaptioned: false }, deps);
    const entries = (list.structuredContent as { entries: Array<{ index: number; source: string }> }).entries;
    const raster = entries.find((e) => e.source === "raster");
    expect(raster).toBeDefined();
    const r = await getFiguresTool.handler(
      { id: PDF_BOOK, indexes: [raster!.index], detail: "standard", include_uncaptioned: false },
      deps,
    );
    expect(r.isError).toBeFalsy();
    const [img] = images(r);
    expect(img).toBeDefined();
    expect(img!.data.length).toBeGreaterThan(1000);
    expect(["image/png", "image/jpeg"]).toContain(img!.mimeType);
  });

  it("lists and fetches EPUB figures", { timeout: 180_000 }, async () => {
    const list = await getFiguresTool.handler({ id: EPUB_BOOK, detail: "standard", include_uncaptioned: false }, deps);
    expect(list.isError).toBeFalsy();
    const s = list.structuredContent as { format: string; counts: { figures: number }; entries: Array<{ index: number; source: string }> };
    expect(s.format).toBe("epub");
    expect(s.counts.figures).toBeGreaterThan(50);
    const raster = s.entries.find((e) => e.source === "raster");
    const r = await getFiguresTool.handler(
      { id: EPUB_BOOK, indexes: [raster!.index], detail: "standard", include_uncaptioned: false },
      deps,
    );
    expect(r.isError).toBeFalsy();
    expect(images(r)).toHaveLength(1);
  });

  it("guards bad indexes with an actionable error", { timeout: 180_000 }, async () => {
    const r = await getFiguresTool.handler(
      { id: PDF_BOOK, indexes: [9999], detail: "standard", include_uncaptioned: false },
      deps,
    );
    expect(r.isError).toBe(true);
    expect(texts(r)[0]?.text).toContain("per-format");
  });
});
