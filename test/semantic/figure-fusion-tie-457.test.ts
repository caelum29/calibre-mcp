// #457: figure ties use one key at every ranking stage. Vector, FTS and rerank already order
// equal scores by (bookId, figureId); hybrid fusion must too, not by figureId alone.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import { stemText } from "../../src/semantic/stem.js";
import { SqliteIndexStore, type ChunkIndex, type FigureHit, type FigureIndex } from "../../src/semantic/store/index.js";

const figure = (figureId: number, bookId: number, score: number): FigureHit => ({
  figureId,
  bookId,
  title: "",
  authors: [],
  figIndex: 1,
  page: 1,
  caption: "c",
  charOffset: 0,
  format: "pdf",
  score,
});

// Figure row ids run AGAINST book order: figure 5 is in book 2, figure 9 in book 1.
const F5 = figure(5, 2, 0.8);
const F9 = figure(9, 1, 0.8);

/** Hybrid figure retrieval over fixed halves; no reranker, so the fused order is the answer. */
function deps(vec: FigureHit[], kw: FigureHit[]): RetrievalDeps {
  const index = {
    searchLibrary: () => [],
    searchLibraryFts: () => [],
    searchBook: () => [],
    searchBookFts: () => [],
    chunkAt: () => undefined,
    searchFigures: () => vec,
    searchFiguresFts: () => kw,
    figureCount: () => 2,
    figuresInSpan: () => [],
  } satisfies ChunkIndex & FigureIndex;
  return {
    index,
    embedder: { embedQuery: async () => new Float32Array(EMBED_DIM) } as unknown as RetrievalDeps["embedder"],
    config: { rerankEnabled: true, semanticFloor: 0.78 },
    log,
  };
}

const run = async (vec: FigureHit[], kw: FigureHit[], topK = 2) =>
  (await retrieve(deps(vec, kw), { scope: "figures", libraryId: "L", query: "q", mode: "hybrid", topK })).hits.map(
    (h) => [h.hit.bookId, h.hit.figureId],
  );

describe("hybrid figure fusion tie-break (#457)", () => {
  it("should_order_a_fused_tie_by_book_id_when_figure_ids_run_against_book_order", async () => {
    // each figure is rank 1 in one half → equal RRF scores
    expect(await run([F5], [F9])).toEqual([
      [1, 9],
      [2, 5],
    ]);
  });

  it("should_keep_the_vector_tie_order_when_the_halves_disagree", async () => {
    // a vector tie (equal cosine) arrives in (bookId, figureId) order; the keyword half has the
    // two reversed → equal fused scores, so the shared key decides
    expect(await run([F9, F5], [F5, F9])).toEqual([
      [1, 9],
      [2, 5],
    ]);
  });

  it("should_keep_the_lower_book_id_when_a_fused_tie_straddles_the_cut", async () => {
    expect(await run([F5], [F9], 1)).toEqual([[1, 9]]);
  });
});

describe("figure keyword search tie at the pool cutoff (#457)", () => {
  const LIB = "Tie_Lib";
  let dir: string;
  let s: SqliteIndexStore;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-tie-457-"));
    s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    // books inserted 3, 1, 2 → figure row ids rise against book order; identical captions tie on bm25
    for (const bookId of [3, 1, 2]) {
      s.replaceBook(
        LIB,
        { bookId, title: "Same", authors: ["A"] },
        [{ body: "alpha beta", charStart: 0, charEnd: 10 }],
        [{ figIndex: 1, page: 1, caption: "gamma delta", charOffset: 0, format: "pdf" }],
      );
    }
  });

  afterAll(() => {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should_keep_the_lowest_book_ids_when_the_limit_cuts_through_a_tie", () => {
    // book 3's figure has the LOWEST row id; a figureId-only cut would keep it
    expect(s.searchFiguresFts(LIB, stemText("gamma"), 2).map((h) => h.bookId)).toEqual([1, 2]);
  });
});
