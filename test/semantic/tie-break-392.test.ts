// #392 decision 3: a total, deterministic tie-break at every ranking stage. Equal scores order by
// ascending book id, then the unit's own id (chunk / figure row), so the order no longer depends
// on stable-sort insertion order, first-seen fusion order or SQLite's scan order.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { rrfFuse } from "../../src/semantic/fusion.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import type { Reranker } from "../../src/semantic/reranker.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import { stemText } from "../../src/semantic/stem.js";
import {
  SqliteIndexStore,
  type BookHit,
  type ChunkIndex,
  type FigureHit,
  type FigureIndex,
  type LibraryHit,
} from "../../src/semantic/store/index.js";
import { l2normalize, topK } from "../../src/semantic/vector.js";

describe("vector topK", () => {
  it("equal cosines order by book id, then chunk id (inserted out of order)", () => {
    const v = l2normalize(Float32Array.from([1, 0, 0]));
    const cands = [
      { chunkId: 30, bookId: 3, vector: v },
      { chunkId: 12, bookId: 1, vector: v },
      { chunkId: 11, bookId: 1, vector: v },
      { chunkId: 20, bookId: 2, vector: v },
    ];
    expect(topK(v, cands, 4).map((h) => [h.bookId, h.chunkId])).toEqual([
      [1, 11],
      [1, 12],
      [2, 20],
      [3, 30],
    ]);
  });
});

describe("rrfFuse", () => {
  it("equal fused scores order by ascending id, not first-seen", () => {
    // 3 and 1 swap ranks across the two lists → identical RRF sums
    expect(
      rrfFuse([
        [3, 1],
        [1, 3],
      ]).map((f) => f.id),
    ).toEqual([1, 3]);
  });

  it("ids each seen once at rank 1 tie too", () => {
    expect(rrfFuse([[5], [2]]).map((f) => f.id)).toEqual([2, 5]);
  });
});

describe("FTS (SQLite) tie order", () => {
  const LIB = "Tie_Lib";
  let dir: string;
  let s: SqliteIndexStore;
  const fig = (figIndex: number) => ({ figIndex, page: 1, caption: "gamma delta", charOffset: 0, format: "pdf" });

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-tie-"));
    s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    // books inserted 3, 1, 2 → row ids rise in that order; identical title + body → identical bm25
    for (const bookId of [3, 1, 2]) {
      s.replaceBook(
        LIB,
        { bookId, title: "Same", authors: ["A"] },
        [{ body: "alpha beta", charStart: 0, charEnd: 10 }],
        [fig(1)],
      );
    }
    // one book, three identical passages
    s.replaceBook(
      LIB,
      { bookId: 9, title: "Other", authors: ["A"] },
      [0, 1, 2].map((i) => ({ body: "omega psi", charStart: i * 20, charEnd: i * 20 + 9 })),
    );
  });

  afterAll(() => {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("library keyword search: equal bm25 → ascending book id", () => {
    expect(s.searchLibraryFts(LIB, stemText("alpha"), 10).map((h) => h.bookId)).toEqual([1, 2, 3]);
  });

  it("library keyword search restricted to a bundle: same order", () => {
    expect(s.searchLibraryFts(LIB, stemText("alpha"), 10, new Set([1, 2, 3])).map((h) => h.bookId)).toEqual([1, 2, 3]);
  });

  it("book keyword search: equal bm25 → ascending chunk id", () => {
    const ids = s.searchBookFts(LIB, 9, stemText("omega"), 10).map((h) => h.chunkId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).toHaveLength(3);
  });

  it("figure keyword search: equal bm25 → ascending book id", () => {
    expect(s.searchFiguresFts(LIB, stemText("gamma"), 10).map((h) => h.bookId)).toEqual([1, 2, 3]);
  });

  it("figure keyword search restricted to a bundle: same order", () => {
    expect(s.searchFiguresFts(LIB, stemText("gamma"), 10, undefined, new Set([1, 2, 3])).map((h) => h.bookId)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("rerank stage", () => {
  // every passage scores the same → the order must come from the ids, not the fused order
  const flat: Reranker = {
    async rerank(_q, passages) {
      return passages.map(() => 0.5);
    },
    async warmup() {},
  };
  const lib = (bookId: number, score: number): LibraryHit => ({
    bookId,
    title: `B${bookId}`,
    authors: [],
    score,
    charStart: 0,
    charEnd: 1,
    snippet: "s",
    body: "b",
  });
  const passage = (chunkId: number, score: number): BookHit => ({
    chunkId,
    charStart: chunkId,
    charEnd: chunkId + 1,
    body: "b",
    score,
    frontMatter: false,
  });
  const figure = (figureId: number, bookId: number, score: number) =>
    ({
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
    }) as FigureHit;

  function deps(): RetrievalDeps {
    const index = {
      // vector halves ranked out of id order
      searchLibrary: () => [lib(3, 0.9), lib(1, 0.85), lib(2, 0.8)],
      searchLibraryFts: () => [],
      searchBook: () => [passage(30, 0.9), passage(10, 0.85), passage(20, 0.8)],
      searchBookFts: () => [],
      chunkAt: () => undefined,
      searchFigures: () => [figure(7, 2, 0.9), figure(9, 1, 0.85), figure(5, 2, 0.8)],
      searchFiguresFts: () => [],
      figureCount: () => 3,
      figuresInSpan: () => [],
    } satisfies ChunkIndex & FigureIndex;
    return {
      index,
      embedder: { embedQuery: async () => new Float32Array(EMBED_DIM) } as unknown as RetrievalDeps["embedder"],
      reranker: flat,
      config: { rerankEnabled: true, semanticFloor: 0.78 },
      log,
    };
  }
  const base = { libraryId: "L", query: "q", mode: "vector", topK: 3 } as const;

  it("library: equal rerank scores → ascending book id", async () => {
    const r = await retrieve(deps(), { ...base, scope: "library" });
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([1, 2, 3]);
  });

  it("book: equal rerank scores → ascending chunk id", async () => {
    const r = await retrieve(deps(), { ...base, scope: "book", bookId: 9 });
    expect(r.hits.map((h) => h.hit.chunkId)).toEqual([10, 20, 30]);
  });

  it("figures: equal rerank scores → ascending book id, then figure id", async () => {
    const r = await retrieve(deps(), { ...base, scope: "figures" });
    expect(r.hits.map((h) => [h.hit.bookId, h.hit.figureId])).toEqual([
      [1, 9],
      [2, 5],
      [2, 7],
    ]);
  });
});
