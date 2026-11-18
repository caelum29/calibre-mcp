// #694 test gaps of the #644 adaptive rerank cut: it also applies to figures hybrid, and it never
// raises a pair cap below ADAPTIVE_RERANK_POOL (min(10, rerankPool)).

import { describe, expect, it } from "vitest";
import { log } from "../../src/logging.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { ADAPTIVE_RERANK_POOL, RERANK_POOL, type Reranker } from "../../src/semantic/reranker.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import type { BookHit, ChunkIndex, FigureHit, FigureIndex } from "../../src/semantic/store/index.js";

/** A figure caption; higher `score` = better cosine. */
const fh = (figureId: number, score = 0.8): FigureHit => ({
  figureId,
  bookId: 1,
  title: "Book 1",
  authors: [],
  figIndex: figureId,
  page: figureId,
  caption: `figure ${figureId}`,
  charOffset: figureId * 100,
  format: "PDF",
  score,
});
const figures = (first: number, n: number) => Array.from({ length: n }, (_, i) => fh(first + i, 0.9 - i * 0.001));

/** A book passage; higher `score` = better cosine. */
const bh = (chunkId: number, score = 0.8): BookHit => ({
  chunkId,
  charStart: chunkId * 100,
  charEnd: chunkId * 100 + 50,
  body: `c${chunkId}`,
  score,
  frontMatter: false,
});
const passages = (first: number, n: number) => Array.from({ length: n }, (_, i) => bh(first + i, 0.9 - i * 0.001));

/** Reranker that records each call's pair count; scores fall with input order. */
function recordingReranker() {
  const pairs: number[] = [];
  const reranker: Reranker = {
    async rerank(_q: string, ps: string[]) {
      pairs.push(ps.length);
      return ps.map((_, i) => 0.9 - i * 0.01);
    },
    async warmup() {},
  };
  return { reranker, pairs };
}

/** Fake index: each half returns its fixed list cut to the k retrieve() asks for. */
function deps(
  halves: { figVec?: FigureHit[]; figKw?: FigureHit[]; bookVec?: BookHit[]; bookKw?: BookHit[] },
  reranker: Reranker,
): RetrievalDeps {
  const index = {
    searchLibrary: () => [],
    searchLibraryFts: () => [],
    searchBook: (_l: string, _b: number, _q: Float32Array, k: number) => (halves.bookVec ?? []).slice(0, k),
    searchBookFts: (_l: string, _b: number, _q: string, k: number) => (halves.bookKw ?? []).slice(0, k),
    chunkAt: () => undefined,
    searchFigures: (_l: string, _q: Float32Array, k: number) => (halves.figVec ?? []).slice(0, k),
    searchFiguresFts: (_l: string, _q: string, k: number) => (halves.figKw ?? []).slice(0, k),
    figureCount: () => 0,
    figuresInSpan: () => [],
  } as unknown as ChunkIndex & FigureIndex;
  return {
    index,
    embedder: { embedQuery: async () => new Float32Array(EMBED_DIM) } as unknown as RetrievalDeps["embedder"],
    reranker,
    config: { rerankEnabled: true, semanticFloor: 0.78 },
    log,
  };
}

const figReq = { scope: "figures", libraryId: "L", query: "q", mode: "hybrid", topK: 5 } as const;
// topK 20 > pool: 20 fused candidates reach the cut, so only the cap itself limits the pairs
const bookReq = { scope: "book", libraryId: "L", bookId: 1, query: "q", mode: "hybrid", topK: 20 } as const;

const FIG40 = figures(1, 40);
const BOOK40 = passages(1, 40);
// keyword halves whose top 3 are the vector top 3 in another order, or a different set
const FIG_AGREE = [fh(3), fh(1), fh(2), ...figures(50, 20)];
const FIG_DISAGREE = [fh(7), fh(8), fh(9), ...figures(50, 20)];
const BOOK_AGREE = [bh(3), bh(1), bh(2), ...passages(50, 20)];
const BOOK_DISAGREE = [bh(7), bh(8), bh(9), ...passages(50, 20)];

describe("adaptive rerank cut in figures hybrid (#694 / #682)", () => {
  it("should_rerank_10_captions_when_both_halves_share_their_top_3_figures", async () => {
    const { reranker, pairs } = recordingReranker();
    await retrieve(deps({ figVec: FIG40, figKw: FIG_AGREE }, reranker), figReq, { adaptivePool: true });
    expect(pairs).toEqual([ADAPTIVE_RERANK_POOL]);
  });

  it("should_keep_the_normal_pool_when_the_figure_halves_disagree", async () => {
    const { reranker, pairs } = recordingReranker();
    await retrieve(deps({ figVec: FIG40, figKw: FIG_DISAGREE }, reranker), figReq, { adaptivePool: true });
    expect(pairs).toEqual([RERANK_POOL]);
  });
});

describe("adaptive rerank cut with rerankPool below 10 (#694 / #682)", () => {
  it("should_keep_a_pool_of_5_when_the_halves_agree", async () => {
    const { reranker, pairs } = recordingReranker();
    await retrieve(deps({ bookVec: BOOK40, bookKw: BOOK_AGREE }, reranker), bookReq, {
      adaptivePool: true,
      rerankPool: 5,
    });
    expect(pairs).toEqual([5]);
  });

  it("should_keep_a_pool_of_5_when_the_halves_disagree", async () => {
    const { reranker, pairs } = recordingReranker();
    await retrieve(deps({ bookVec: BOOK40, bookKw: BOOK_DISAGREE }, reranker), bookReq, {
      adaptivePool: true,
      rerankPool: 5,
    });
    expect(pairs).toEqual([5]);
  });

  it("should_cut_a_pool_of_10_to_exactly_10_when_the_halves_agree", async () => {
    const { reranker, pairs } = recordingReranker();
    await retrieve(deps({ bookVec: BOOK40, bookKw: BOOK_AGREE }, reranker), bookReq, {
      adaptivePool: true,
      rerankPool: 10,
    });
    expect(pairs).toEqual([10]);
  });
});
