// retrieve() service (#259): opts.rrfWeights is the eval sweep's seam into hybrid fusion
// (replacing the old source-rewriting sed), and the default weights stay plain RRF.

import { describe, expect, it } from "vitest";
import { log } from "../../src/logging.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import type { ChunkIndex, FigureIndex, LibraryHit } from "../../src/semantic/store/index.js";

const hit = (bookId: number, score = 0): LibraryHit => ({
  bookId,
  title: `Book ${bookId}`,
  authors: ["A"],
  score,
  charStart: 0,
  charEnd: 10,
  snippet: "s",
  body: "b",
});

// Vector half ranks 1 > 2 > 3; keyword half ranks 3 > 2 > 1 — weights alone pick the winner.
function deps(): RetrievalDeps {
  const index = {
    searchLibrary: () => [hit(1, 0.9), hit(2, 0.85), hit(3, 0.8)],
    searchLibraryFts: () => [hit(3), hit(2), hit(1)],
    searchBook: () => [],
    searchBookFts: () => [],
    chunkAt: () => undefined,
    searchFigures: () => [],
    searchFiguresFts: () => [],
    figureCount: () => 0,
    figuresInSpan: () => [],
  } satisfies ChunkIndex & FigureIndex;
  return {
    index,
    embedder: { embedQuery: async () => new Float32Array(4) } as unknown as RetrievalDeps["embedder"],
    config: { rerankEnabled: true, semanticFloor: 0.78 },
    log,
  };
}

const req = { scope: "library", libraryId: "L", query: "q", mode: "hybrid", topK: 3 } as const;

describe("retrieve (library, hybrid)", () => {
  it("vector-heavy weights put the vector half's top hit first", async () => {
    const r = await retrieve(deps(), req, { rrfWeights: [2, 1] });
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([1, 2, 3]);
  });

  it("keyword-heavy weights put the keyword half's top hit first", async () => {
    const r = await retrieve(deps(), req, { rrfWeights: [1, 2] });
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([3, 2, 1]);
  });

  it("keeps the vector cosine on fused hits and reports the max without a reranker", async () => {
    const r = await retrieve(deps(), req);
    expect(r.hits.map((h) => h.cosine).sort()).toEqual([0.8, 0.85, 0.9]);
    expect(r).toMatchObject({ maxScore: 0.9, reranked: false, lowConfidence: false, notes: [] });
  });
});
