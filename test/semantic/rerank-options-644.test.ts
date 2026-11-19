// Rerank latency seam (#644): RetrievalOptions.rerankPool / rerankMaxTokens / adaptivePool let the
// A/B arms change one rerank constant each from an in-process script, while retrieve() with no
// options keeps the shipped behaviour (pool 30, 512-token pairs, no adaptive cut).

import { describe, expect, it } from "vitest";
import { log } from "../../src/logging.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import {
  ADAPTIVE_AGREE_TOP,
  ADAPTIVE_RERANK_POOL,
  RERANK_POOL,
  type RerankCallOptions,
  type Reranker,
} from "../../src/semantic/reranker.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import type { BookHit, ChunkIndex, FigureIndex, LibraryHit } from "../../src/semantic/store/index.js";

/** A book passage; higher `score` = better cosine. */
const bh = (chunkId: number, score = 0.8): BookHit => ({
  chunkId,
  charStart: chunkId * 100,
  charEnd: chunkId * 100 + 50,
  body: `c${chunkId}`,
  score,
});

/** A library hit, one per book (the vector half returns books). */
const lh = (bookId: number, score = 0.8): LibraryHit => ({
  bookId,
  chunkId: bookId * 10,
  title: `Book ${bookId}`,
  authors: [],
  score,
  snippet: `b${bookId}`,
  body: `b${bookId}`,
  charStart: 0,
  charEnd: 50,
});

/** `n` passages with ids from `first`, cosine falling with rank. */
const passages = (first: number, n: number) => Array.from({ length: n }, (_, i) => bh(first + i, 0.9 - i * 0.001));

/** Reranker that records each call's pair count and third argument; scores fall with input order. */
function recordingReranker() {
  const calls: Array<{ pairs: number; opts: RerankCallOptions | undefined; argc: number }> = [];
  const reranker: Reranker = {
    async rerank(...args: [string, string[], RerankCallOptions?]) {
      const [, ps, opts] = args;
      calls.push({ pairs: ps.length, opts, argc: args.length });
      return ps.map((_, i) => 0.9 - i * 0.01);
    },
    async warmup() {},
  };
  return { reranker, calls };
}

/** Fake index: each half returns its fixed list cut to the k retrieve() asks for. */
function deps(
  halves: { bookVec?: BookHit[]; bookKw?: BookHit[]; libVec?: LibraryHit[]; libKw?: LibraryHit[] },
  reranker: Reranker,
): RetrievalDeps {
  const index = {
    searchLibrary: (_l: string, _q: Float32Array, k: number) => (halves.libVec ?? []).slice(0, k),
    searchLibraryFts: (_l: string, _q: string, k: number) => (halves.libKw ?? []).slice(0, k),
    searchBook: (_l: string, _b: number, _q: Float32Array, k: number) => (halves.bookVec ?? []).slice(0, k),
    searchBookFts: (_l: string, _b: number, _q: string, k: number) => (halves.bookKw ?? []).slice(0, k),
    chunkAt: () => undefined,
    searchFigures: () => [],
    searchFiguresFts: () => [],
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

const book = (mode: "hybrid" | "vector", topK = 5) =>
  ({ scope: "book", libraryId: "L", bookId: 1, query: "q", mode, topK }) as const;
const lib = (topK = 5) => ({ scope: "library", libraryId: "L", query: "q", mode: "hybrid", topK }) as const;

// 40 vector passages 1..40; the keyword half's top 3 are a different set unless a test says otherwise
const VEC40 = passages(1, 40);
const KW_DISAGREE = [bh(7), bh(8), bh(9), ...passages(10, 30)];

describe("rerank options (#644): each option overrides only its constant", () => {
  it("no options: the cross-encoder scores RERANK_POOL (30) pairs with two arguments", async () => {
    const { reranker, calls } = recordingReranker();
    await retrieve(deps({ bookVec: VEC40, bookKw: KW_DISAGREE }, reranker), book("hybrid"));
    expect(calls).toEqual([{ pairs: RERANK_POOL, opts: undefined, argc: 2 }]);
  });

  it("no options gives the same output as an explicit rerankPool of RERANK_POOL", async () => {
    const a = recordingReranker();
    const b = recordingReranker();
    const plain = await retrieve(deps({ bookVec: VEC40, bookKw: KW_DISAGREE }, a.reranker), book("hybrid"));
    const explicit = await retrieve(deps({ bookVec: VEC40, bookKw: KW_DISAGREE }, b.reranker), book("hybrid"), {
      rerankPool: RERANK_POOL,
    });
    expect(explicit).toEqual(plain);
  });

  it("rerankPool 15 cuts the rerank to 15 pairs and passes no maxTokens", async () => {
    const { reranker, calls } = recordingReranker();
    await retrieve(deps({ bookVec: VEC40, bookKw: KW_DISAGREE }, reranker), book("hybrid"), { rerankPool: 15 });
    expect(calls).toEqual([{ pairs: 15, opts: undefined, argc: 2 }]);
  });

  it("rerankPool 15 keeps topK hits: the unscored tail follows the reranked head in fused order", async () => {
    const { reranker } = recordingReranker();
    const r = await retrieve(deps({ bookVec: VEC40, bookKw: KW_DISAGREE }, reranker), book("hybrid", 20), {
      rerankPool: 15,
    });
    expect([r.hits.length, r.hits.filter((h) => h.rerankScore !== undefined).length]).toEqual([20, 15]);
  });

  it("rerankPool 50 also raises the candidate count (vector mode materializes 50, scores 50)", async () => {
    const { reranker, calls } = recordingReranker();
    await retrieve(deps({ bookVec: passages(1, 60) }, reranker), book("vector"), { rerankPool: 50 });
    expect(calls.map((c) => c.pairs)).toEqual([50]);
  });

  it("rerankMaxTokens 256 reaches the reranker as its third argument, pool unchanged", async () => {
    const { reranker, calls } = recordingReranker();
    await retrieve(deps({ bookVec: VEC40, bookKw: KW_DISAGREE }, reranker), book("hybrid"), { rerankMaxTokens: 256 });
    expect(calls).toEqual([{ pairs: RERANK_POOL, opts: { maxTokens: 256 }, argc: 3 }]);
  });
});

describe("adaptive pool (#644): hybrid halves agreeing on their top 3 shrink the rerank", () => {
  it("the rule's numbers are named constants: top 3 agree → 10 pairs", () => {
    expect([ADAPTIVE_AGREE_TOP, ADAPTIVE_RERANK_POOL]).toEqual([3, 10]);
  });

  it("book scope: same top-3 chunk ids in another order → rerank only the first 10 fused candidates", async () => {
    const { reranker, calls } = recordingReranker();
    const kw = [bh(3), bh(1), bh(2), ...passages(50, 20)];
    await retrieve(deps({ bookVec: VEC40, bookKw: kw }, reranker), book("hybrid"), { adaptivePool: true });
    expect(calls.map((c) => c.pairs)).toEqual([ADAPTIVE_RERANK_POOL]);
  });

  it("book scope: two of three shared → the normal pool of 30", async () => {
    const { reranker, calls } = recordingReranker();
    const kw = [bh(1), bh(2), bh(9), ...passages(50, 20)];
    await retrieve(deps({ bookVec: VEC40, bookKw: kw }, reranker), book("hybrid"), { adaptivePool: true });
    expect(calls.map((c) => c.pairs)).toEqual([RERANK_POOL]);
  });

  it("fewer than 3 keyword hits counts as no agreement", async () => {
    const { reranker, calls } = recordingReranker();
    const vec = [bh(1), bh(2), ...passages(10, 38)];
    await retrieve(deps({ bookVec: vec, bookKw: [bh(1), bh(2)] }, reranker), book("hybrid"), { adaptivePool: true });
    expect(calls.map((c) => c.pairs)).toEqual([RERANK_POOL]);
  });

  it("vector mode always uses the normal pool", async () => {
    const { reranker, calls } = recordingReranker();
    await retrieve(deps({ bookVec: VEC40, bookKw: [bh(3), bh(1), bh(2)] }, reranker), book("vector"), {
      adaptivePool: true,
    });
    expect(calls.map((c) => c.pairs)).toEqual([RERANK_POOL]);
  });

  it("without the option, agreeing halves still get the normal pool", async () => {
    const { reranker, calls } = recordingReranker();
    const kw = [bh(3), bh(1), bh(2), ...passages(50, 20)];
    await retrieve(deps({ bookVec: VEC40, bookKw: kw }, reranker), book("hybrid"));
    expect(calls.map((c) => c.pairs)).toEqual([RERANK_POOL]);
  });

  it("library scope: the same top-3 books in both halves → 10 pairs", async () => {
    const { reranker, calls } = recordingReranker();
    const vec = Array.from({ length: 40 }, (_, i) => lh(i + 1, 0.9 - i * 0.001));
    const kw = [lh(2), lh(3), lh(1), ...Array.from({ length: 20 }, (_, i) => lh(100 + i))];
    // keyword chunks equal the vector chunks (same chunkId per book), so no #604 second candidates
    await retrieve(deps({ libVec: vec, libKw: kw }, reranker), lib(), { adaptivePool: true });
    expect(calls.map((c) => c.pairs)).toEqual([ADAPTIVE_RERANK_POOL]);
  });

  it("a shrunk rerank still reports maxRerank and lowConfidence", async () => {
    const { reranker } = recordingReranker();
    const kw = [bh(3), bh(1), bh(2), ...passages(50, 20)];
    const r = await retrieve(deps({ bookVec: VEC40, bookKw: kw }, reranker), book("hybrid"), { adaptivePool: true });
    expect([r.reranked, r.maxRerank, r.lowConfidence]).toEqual([true, 0.9, false]);
  });
});
