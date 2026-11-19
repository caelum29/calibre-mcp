// #605 ranking in retrieve(): strong kinds (index, copyright/ads, prose-less front) never take a
// rerank pair and follow the reranked hits; weak kinds (bibliography, prose front) are reranked,
// then placed after body books in library scope but keep their rerank position in book scope;
// without a rerank every non-body hit follows the body hits. Plus #678: the lowConfidence flip
// that #604's keyword candidate causes, pinned with exact values.

import { describe, expect, it } from "vitest";
import { log } from "../../src/logging.js";
import type { MatterKind } from "../../src/domain/structure/matter-kind.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import type { Reranker } from "../../src/semantic/reranker.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import type { BookHit, ChunkIndex, FigureIndex, LibraryHit } from "../../src/semantic/store/index.js";

const TOC = ["Contents", "1 Basics ........ 1", "2 Retrieval ........ 21", "3 Rerankers ........ 45"].join("\n");
const PREFACE = [
  "Using Code Examples",
  "Supplemental material (code examples, exercises, and so on) is available for download",
  "from the book's GitHub repository, where each chapter has its own folder of notebooks",
  "that you can run locally; if you find a problem, please open an issue on the repository.",
].join("\n");

const lh = (bookId: number, body: string, score: number, matterKind: MatterKind = "body"): LibraryHit => ({
  bookId,
  chunkId: bookId * 10,
  title: `Book ${bookId}`,
  authors: [],
  score,
  snippet: body,
  body,
  charStart: 0,
  charEnd: body.length,
  matterKind,
});

const bh = (chunkId: number, body: string, score: number, matterKind: MatterKind = "body"): BookHit => ({
  chunkId,
  charStart: chunkId * 100,
  charEnd: chunkId * 100 + 90,
  body,
  score,
  matterKind,
});

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

interface Fake {
  vec?: LibraryHit[];
  kw?: LibraryHit[];
  bookVec?: BookHit[];
  bookKw?: BookHit[];
}

function deps(f: Fake, reranker?: Reranker): RetrievalDeps {
  const index = {
    searchLibrary: () => f.vec ?? [],
    searchLibraryFts: () => f.kw ?? [],
    searchBook: () => f.bookVec ?? [],
    searchBookFts: () => f.bookKw ?? [],
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
    config: { rerankEnabled: true, semanticFloor: 0.78 },
    log,
  };
}

type Mode = "hybrid" | "vector" | "keyword";
const lib = (mode: Mode, topK = 10) => ({ scope: "library", libraryId: "L", query: "q", mode, topK }) as const;
const inBook = (mode: Mode, topK = 10) =>
  ({ scope: "book", libraryId: "L", bookId: 1, query: "q", mode, topK }) as const;

const NOTE_2 = "2 front/back-matter passage(s) placed after body matches.";

describe("library scope (#605)", () => {
  // b2 is represented by an index page (strong), b3 by a bibliography (weak).
  const VEC = [
    lh(1, "B1", 0.9),
    lh(2, "IDX2", 0.95, "back_index"),
    lh(3, "BIB3", 0.85, "back_biblio"),
    lh(4, "B4", 0.8),
  ];

  it("a strong-kind representative never reaches the reranker", async () => {
    const { reranker, calls } = bodyReranker({ B1: 0.3, B4: 0.6, BIB3: 0.99, IDX2: 0.99 });
    await retrieve(deps({ vec: VEC }, reranker), lib("vector"));
    expect(calls).toEqual([["B1", "BIB3", "B4"]]);
  });

  it("body books by rerank score, then weak books, then strong books in fused order", async () => {
    const { reranker } = bodyReranker({ B1: 0.3, B4: 0.6, BIB3: 0.99 });
    const r = await retrieve(deps({ vec: VEC }, reranker), lib("vector"));
    expect(r.hits.map((h) => [h.hit.bookId, h.rerankScore])).toEqual([
      [4, 0.6],
      [1, 0.3],
      [3, 0.99],
      [2, undefined],
    ]);
    expect(r.notes).toEqual([NOTE_2]);
  });

  it("strong books keep their fused order among themselves after the reranked hits", async () => {
    const vec = [lh(5, "OTHER5", 0.99, "back_other"), lh(1, "B1", 0.9), lh(2, "IDX2", 0.95, "back_index")];
    const { reranker } = bodyReranker({ B1: 0.3 });
    const r = await retrieve(deps({ vec }, reranker), lib("vector"));
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([1, 5, 2]);
  });

  it("without a rerank (keyword mode) every non-body book follows the body books, fused order kept", async () => {
    const kw = [lh(2, "IDX2", -9, "back_index"), lh(1, "B1", -8), lh(3, "BIB3", -7, "back_biblio"), lh(4, "B4", -6)];
    const r = await retrieve(deps({ kw }), lib("keyword"));
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([1, 4, 2, 3]);
    expect(r.notes).toEqual([NOTE_2]);
  });

  it("a non-body keyword chunk never joins as a second rerank candidate (#604 candidates are body)", async () => {
    const vec = [lh(1, "B1", 0.9)];
    const kw = [{ ...lh(1, "IDX1", -9, "back_index"), chunkId: 11 }];
    const { reranker, calls } = bodyReranker({ B1: 0.2, IDX1: 0.9 });
    await retrieve(deps({ vec, kw }, reranker), lib("hybrid"));
    expect(calls).toEqual([["B1"]]);
  });

  it("an all-body result carries no demotion note", async () => {
    const { reranker } = bodyReranker({ B1: 0.3, B4: 0.6 });
    const r = await retrieve(deps({ vec: [lh(1, "B1", 0.9), lh(4, "B4", 0.8)] }, reranker), lib("vector"));
    expect(r.notes).toEqual([]);
  });
});

describe("book scope (#605)", () => {
  // The book-888 shape: the preface answers (0.99) among body hits at ≤ 0.05.
  const VEC = [
    bh(1, TOC, 0.9, "front"),
    bh(2, PREFACE, 0.85, "front"),
    bh(9, "abstraction, 12\nagents, 101\nattention, 289", 0.8, "back_index"),
    bh(5, "ch. 7 intro", 0.7),
    bh(6, "ch. 1 intro", 0.6),
  ];
  const SCORES = { [PREFACE]: 0.99, "ch. 7 intro": 0.046, "ch. 1 intro": 0.009, [TOC]: 0.9 };

  it("the prose preface keeps its rerank position at rank 1; contents and index pages follow the body hits", async () => {
    const { reranker } = bodyReranker(SCORES);
    const r = await retrieve(deps({ bookVec: VEC }, reranker), inBook("vector"));
    expect(r.hits.map((h) => h.hit.chunkId)).toEqual([2, 5, 6, 1, 9]);
    expect(r.notes).toEqual([NOTE_2]);
  });

  it("contents and index pages take no rerank pair", async () => {
    const { reranker, calls } = bodyReranker(SCORES);
    await retrieve(deps({ bookVec: VEC }, reranker), inBook("vector"));
    expect(calls).toEqual([[PREFACE, "ch. 7 intro", "ch. 1 intro"]]);
  });

  it("keyword mode partitions every non-body passage after the body passages", async () => {
    const r = await retrieve(deps({ bookKw: VEC.map((h) => ({ ...h, score: -h.score })) }), inBook("keyword"));
    expect(r.hits.map((h) => h.hit.chunkId)).toEqual([5, 6, 1, 2, 9]);
    expect(r.notes).toEqual(["3 front/back-matter passage(s) placed after body matches."]);
  });
});

describe("lowConfidence after #604's keyword candidate (#678)", () => {
  // Book 1: vector chunk V1 (cosine 0.9, rerank 0.001); keyword chunk K1 (rerank 0.9).
  const vec = [lh(1, "V1", 0.9)];

  it("without a second candidate the weak rerank marks the result low-confidence", async () => {
    const { reranker } = bodyReranker({ V1: 0.001, K1: 0.9 });
    const r = await retrieve(deps({ vec, kw: [] }, reranker), lib("hybrid"));
    expect([r.lowConfidence, r.maxRerank, r.maxScore]).toEqual([true, 0.001, 0.9]);
  });

  it("the keyword chunk's 0.9 becomes maxRerank and flips lowConfidence to false", async () => {
    const { reranker } = bodyReranker({ V1: 0.001, K1: 0.9 });
    const kw = [{ ...lh(1, "K1", -5), chunkId: 11 }];
    const r = await retrieve(deps({ vec, kw }, reranker), lib("hybrid"));
    expect([r.lowConfidence, r.maxRerank, r.maxScore, r.hits[0]!.hit.body]).toEqual([false, 0.9, 0.9, "K1"]);
  });
});
