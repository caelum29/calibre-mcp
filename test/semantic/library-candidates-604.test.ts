// Library-scope rerank candidates (#604, Fix A): a book in both halves whose keyword-best chunk
// differs from its vector-best chunk gets that chunk as a second rerank candidate when the book
// is in the keyword half's top 5; the cross-encoder still scores at most RERANK_POOL pairs, and
// each book keeps its best-scoring candidate.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import type { Reranker } from "../../src/semantic/reranker.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import {
  type BookHit,
  type ChunkIndex,
  type FigureIndex,
  type LibraryHit,
  SqliteIndexStore,
} from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

/** A library hit for one chunk; its span is derived from the chunk id so tests can tell chunks apart. */
const lh = (bookId: number, chunkId: number, body: string, score: number): LibraryHit => ({
  bookId,
  chunkId,
  title: `Book ${bookId}`,
  authors: [],
  score,
  snippet: body,
  body,
  charStart: chunkId * 100,
  charEnd: chunkId * 100 + 50,
});

/** Reranker that scores each passage by its body text (unknown bodies score 0.1) and records every call. */
function bodyReranker(scores: Record<string, number>) {
  const calls: string[][] = [];
  const reranker: Reranker = {
    async rerank(_q, passages) {
      calls.push([...passages]);
      return passages.map((p) => scores[p] ?? 0.1);
    },
    async warmup() {},
  };
  return { reranker, calls };
}

function deps(
  vec: LibraryHit[],
  kw: LibraryHit[],
  reranker?: Reranker,
  extra: { rerankEnabled?: boolean; book?: BookHit[] } = {},
): RetrievalDeps {
  const index = {
    searchLibrary: () => vec,
    searchLibraryFts: () => kw,
    searchBook: () => extra.book ?? [],
    searchBookFts: () => [],
    chunkAt: () => undefined,
    searchFigures: () => [],
    searchFiguresFts: () => [],
    figureCount: () => 0,
    figuresInSpan: () => [],
  } satisfies ChunkIndex & FigureIndex;
  return {
    index,
    embedder: { embedQuery: async () => new Float32Array(EMBED_DIM) } as unknown as RetrievalDeps["embedder"],
    ...(reranker ? { reranker } : {}),
    config: { rerankEnabled: extra.rerankEnabled ?? true, semanticFloor: 0.78 },
    log,
  };
}

const lib = (topK: number) => ({ scope: "library", libraryId: "L", query: "q", mode: "hybrid", topK }) as const;

/** Book 1 is in both halves with different best chunks (vector 11, keyword 12); books 2 and 3 are vector-only. */
const VEC = [lh(1, 11, "v1", 0.8), lh(2, 21, "v2", 0.79), lh(3, 31, "v3", 0.78)];
const KW = [lh(1, 12, "k1", -5)];

describe("library rerank candidates (#604)", () => {
  it("keeps the keyword chunk when it outscores the vector chunk, with the vector half's cosine", async () => {
    const { reranker } = bodyReranker({ k1: 0.9, v1: 0.2, v2: 0.5, v3: 0.4 });
    const r = await retrieve(deps(VEC, KW, reranker), lib(3));
    const top = r.hits[0]!;
    expect([top.hit.bookId, top.hit.body, top.hit.charStart, top.hit.charEnd, top.rerankScore, top.cosine]).toEqual([
      1,
      "k1",
      1200,
      1250,
      0.9,
      0.8,
    ]);
  });

  it("keeps the vector chunk when it outscores the keyword chunk", async () => {
    const { reranker } = bodyReranker({ k1: 0.2, v1: 0.9 });
    const r = await retrieve(deps(VEC, KW, reranker), lib(3));
    expect([r.hits[0]!.hit.body, r.hits[0]!.hit.charStart, r.hits[0]!.rerankScore]).toEqual(["v1", 1100, 0.9]);
  });

  it("keeps the vector chunk on equal scores", async () => {
    const { reranker } = bodyReranker({ k1: 0.6, v1: 0.6 });
    const r = await retrieve(deps(VEC, KW, reranker), lib(3));
    expect([r.hits[0]!.hit.bookId, r.hits[0]!.hit.body]).toEqual([1, "v1"]);
  });

  it("scores both candidates of a two-candidate book in the one rerank call", async () => {
    const { reranker, calls } = bodyReranker({});
    await retrieve(deps(VEC, KW, reranker), lib(3));
    expect(calls).toEqual([["v1", "k1", "v2", "v3"]]);
  });

  it("sends a chunk both halves return only once", async () => {
    const { reranker, calls } = bodyReranker({});
    await retrieve(deps(VEC, [lh(1, 11, "v1", -5)], reranker), lib(3));
    expect(calls).toEqual([["v1", "v2", "v3"]]);
  });

  it("gives no second candidate to a book at keyword rank 6", async () => {
    const vec = [1, 2, 3, 4, 5, 6].map((b) => lh(b, b * 10 + 1, `v${b}`, 0.9 - b / 100));
    const kw = [1, 2, 3, 4, 5].map((b) => lh(b, b * 10 + 1, `v${b}`, -9 + b)).concat(lh(6, 62, "k6", -3));
    const { reranker, calls } = bodyReranker({});
    await retrieve(deps(vec, kw, reranker), lib(6));
    expect(calls).toEqual([["v1", "v2", "v3", "v4", "v5", "v6"]]);
  });

  // book 4 ties book 1 at fused score 1/61 (each is #1 of one half): the tie goes to the lower id
  it("keeps a keyword-only book's keyword chunk as its single candidate", async () => {
    const { reranker, calls } = bodyReranker({ k4: 0.95 });
    const r = await retrieve(deps(VEC, [lh(4, 41, "k4", -5)], reranker), lib(4));
    expect([calls, r.hits[0]!.hit.bookId, r.hits[0]!.hit.body]).toEqual([[["v1", "k4", "v2", "v3"]], 4, "k4"]);
  });

  describe("pair cap (RERANK_POOL = 30)", () => {
    // 40 vector-ranked books; the keyword half's top 5 are books 1–5 with different chunks
    const vec40 = Array.from({ length: 40 }, (_, i) => lh(i + 1, (i + 1) * 10 + 1, `v${i + 1}`, 0.9 - i / 1000));
    const kw5 = [1, 2, 3, 4, 5].map((b) => lh(b, b * 10 + 2, `k${b}`, -10 + b));

    it("scores exactly 30 passages in one call, covering the first 25 fused books", async () => {
      const { reranker, calls } = bodyReranker({});
      await retrieve(deps(vec40, kw5, reranker), lib(40));
      const books = new Set(calls[0]!.map((p) => Number(p.slice(1))));
      expect([calls.length, calls[0]!.length, [...books].sort((a, b) => a - b)]).toEqual([
        1,
        30,
        Array.from({ length: 25 }, (_, i) => i + 1),
      ]);
    });

    it("emits the books past the cap unscored, in fused order, with their vector chunk", async () => {
      const { reranker } = bodyReranker({});
      const r = await retrieve(deps(vec40, kw5, reranker), lib(40));
      const tail = r.hits.slice(25).map((h) => [h.hit.bookId, h.hit.body, h.rerankScore]);
      expect(tail).toEqual(Array.from({ length: 15 }, (_, i) => [26 + i, `v${26 + i}`, undefined]));
    });

    it("ends admission at a two-candidate book that would pass 30 pairs, even when a later book fits", async () => {
      // vector-dominant weights pin the fused order to the vector order: books 1–29 single,
      // book 30 also keyword #1 with a different chunk (two candidates), book 31 single
      const vec31 = vec40.slice(0, 31);
      const { reranker, calls } = bodyReranker({});
      const r = await retrieve(deps(vec31, [lh(30, 302, "k30", -9)], reranker), lib(31), {
        rrfWeights: [1, 0.001],
      });
      expect([calls[0]!.length, calls[0]!.includes("v31"), r.hits.map((h) => h.hit.bookId).slice(29)]).toEqual([
        29,
        false,
        [30, 31],
      ]);
    });
  });

  it("orders books with equal kept scores by ascending book id", async () => {
    // book 2 leads the fused order (both halves) and keeps its keyword chunk at 0.7; book 1 keeps 0.7 too
    const vec = [lh(2, 21, "v2", 0.85), lh(1, 11, "v1", 0.8)];
    const { reranker } = bodyReranker({ v2: 0.3, k2: 0.7, v1: 0.7 });
    const r = await retrieve(deps(vec, [lh(2, 22, "k2", -5)], reranker), lib(2));
    expect(r.hits.map((h) => [h.hit.bookId, h.hit.body])).toEqual([
      [1, "v1"],
      [2, "k2"],
    ]);
  });

  it("without the rerank stage returns the fused order with the vector chunk", async () => {
    const { reranker } = bodyReranker({ k1: 0.9 });
    const r = await retrieve(deps(VEC, KW, reranker, { rerankEnabled: false }), lib(3));
    expect(r.hits.map((h) => [h.hit.bookId, h.hit.body, h.rerankScore])).toEqual([
      [1, "v1", undefined],
      [2, "v2", undefined],
      [3, "v3", undefined],
    ]);
  });

  it("when the reranker fails returns the fused order with the vector chunk", async () => {
    const failing: Reranker = {
      async rerank() {
        throw new Error("boom");
      },
      async warmup() {},
    };
    const r = await retrieve(deps(VEC, KW, failing), lib(3));
    expect(r.hits.map((h) => [h.hit.bookId, h.hit.body])).toEqual([
      [1, "v1"],
      [2, "v2"],
      [3, "v3"],
    ]);
  });

  it("book scope sends one reranker pair per passage", async () => {
    const passage = (chunkId: number): BookHit => ({
      chunkId,
      charStart: chunkId,
      charEnd: chunkId + 1,
      body: `p${chunkId}`,
      score: 0.9 - chunkId / 100,
      frontMatter: false,
    });
    const { reranker, calls } = bodyReranker({});
    const d = deps([], [], reranker, { book: [passage(1), passage(2), passage(3)] });
    await retrieve(d, { scope: "book", libraryId: "L", bookId: 1, query: "q", mode: "vector", topK: 3 });
    expect(calls).toEqual([["p1", "p2", "p3"]]);
  });
});

describe("library hits carry their chunk id (#604)", () => {
  function axis(i: number): Float32Array {
    const v = new Float32Array(EMBED_DIM);
    v[i] = 1;
    return l2normalize(v);
  }

  it("vector and keyword library hits name the chunk book scope reports for the same passage", () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    s.replaceBook("L", { bookId: 1, title: "One", authors: [] }, [
      { body: "plain opening words", charStart: 0, charEnd: 19, vector: axis(0) },
      { body: "the zebra section", charStart: 20, charEnd: 37, vector: axis(1) },
    ]);
    const kwChunk = s.searchBookFts("L", 1, "zebra", 1)[0]!.chunkId;
    const vecChunk = s.searchBook("L", 1, axis(1), 1)[0]!.chunkId;
    expect([s.searchLibraryFts("L", "zebra", 1)[0]!.chunkId, s.searchLibrary("L", axis(1), 1)[0]!.chunkId]).toEqual([
      kwChunk,
      vecChunk,
    ]);
    s.close();
  });
});
