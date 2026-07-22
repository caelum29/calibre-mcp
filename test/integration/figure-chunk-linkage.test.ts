// Deterministic figure↔chunk linkage integration test (#85 item 7 / #86): runs the REAL
// pipeline end to end — caption-line marker injection (injectFigureMarkers) → chunking
// (chunkForEmbedding) → figures + chunks in one SqliteIndexStore book — and asserts the
// char_offset join works in BOTH directions on real, pipeline-produced offsets. Offline,
// model-free (keyword-only rows), part of `pnpm test`.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { FigureInventory } from "../../src/domain/figures/inventory.js";
import { injectFigureMarkers } from "../../src/domain/figures/markers.js";
import { chunkForEmbedding } from "../../src/semantic/chunk.js";
import { SqliteIndexStore, type IndexedFigure } from "../../src/semantic/store.js";

const LIB = "Linkage_Test";
const BOOK = 7;

/** A PDF-shaped text: two pages (\f), real caption LINES the injector anchor-matches. */
function fixtureText(): string {
  const para = (s: string) => `${s} `.repeat(60).trim();
  return [
    para("The ownership chapter explains moves and borrows in depth"),
    "Figure 1-1. The ownership tree with parent scopes",
    para("More prose about lifetimes follows the first figure and keeps going"),
    "\f" + para("Second page opens with the borrow checker discussion"),
    "Figure 2-3. Borrow checker decision flow",
    para("Closing prose after the second caption wraps the chapter up"),
  ].join("\n");
}

const inventory: FigureInventory = {
  entries: [
    { index: 0, page: 1, captioned: true, label: "1-1", caption: "The ownership tree with parent scopes", source: "page-render" },
    { index: 1, page: 2, captioned: true, label: "2-3", caption: "Borrow checker decision flow", source: "raster", width: 640, height: 480, pdfImageNum: 3 },
  ],
  pageCount: 2,
  scanned: false,
  counts: { figures: 2, uncaptioned: 0, pageRender: 1 },
};

describe("figure↔chunk linkage through the real inject→chunk→store pipeline", () => {
  it("joins char_offset to chunk spans in both directions, each figure in exactly one chunk", () => {
    const marked = injectFigureMarkers(fixtureText(), inventory, "pdf");
    expect(marked.unplaced).toBe(0);
    expect(marked.markers).toHaveLength(2);

    // Small budget → several chunks, so the join actually discriminates between spans.
    const chunks = chunkForEmbedding(marked.text, { budget: 700 });
    expect(chunks.length).toBeGreaterThan(2);

    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const figures: IndexedFigure[] = marked.markers.map((m) => ({
      figIndex: m.index,
      page: m.page,
      caption: m.caption,
      charOffset: m.charOffset,
      format: "pdf",
    }));
    store.replaceBook(
      LIB,
      { bookId: BOOK, title: "Linkage Fixture", authors: [] },
      chunks.map((c) => ({ charStart: c.charStart, charEnd: c.charEnd, body: c.body })),
      figures,
    );

    // Direction 1 (figure → context chunk): the chunk found via chunkAt really CONTAINS the
    // marker line at the pipeline-produced offset.
    for (const m of marked.markers) {
      const ctx = store.chunkAt(LIB, BOOK, m.charOffset);
      expect(ctx).toBeDefined();
      expect(marked.text.slice(m.charOffset, m.charOffset + 7)).toBe("[image ");
      expect(ctx!.body).toContain(`[image #${m.index}:`);
      expect(m.charOffset).toBeGreaterThanOrEqual(ctx!.charStart);
      expect(m.charOffset).toBeLessThan(ctx!.charEnd);
    }

    // Direction 2 (chunk span → its figures) + the boundary guarantee: across all chunk
    // spans every figure appears EXACTLY once — no orphan, no double-count even when an
    // offset coincides with a chunk boundary (half-open join).
    const seen: number[] = [];
    for (const c of chunks) {
      for (const f of store.figuresInSpan(LIB, BOOK, c.charStart, c.charEnd)) {
        seen.push(f.figIndex);
        expect(store.chunkAt(LIB, BOOK, f.charOffset)!.charStart).toBe(c.charStart);
      }
    }
    expect(seen.sort()).toEqual([0, 1]);
    store.close();
  });

  it("boundary offset joins to exactly one chunk (the one whose text starts there)", () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    store.replaceBook(
      LIB,
      { bookId: BOOK, title: "Boundary", authors: [] },
      [
        { charStart: 0, charEnd: 40, body: "a".repeat(40) },
        { charStart: 40, charEnd: 80, body: "b".repeat(40) },
      ],
      [{ figIndex: 0, page: 1, caption: "on the seam", charOffset: 40, format: "pdf" }],
    );
    expect(store.chunkAt(LIB, BOOK, 40)!.charStart).toBe(40);
    expect(store.figuresInSpan(LIB, BOOK, 0, 40)).toHaveLength(0);
    expect(store.figuresInSpan(LIB, BOOK, 40, 80)).toHaveLength(1);
    store.close();
  });
});
