// #605 review round 1: confidence reads the body tier the user sees first; a result made only of
// strong front/back matter still reaches the rerank-based lowConfidence decision; and non-body
// fallback books never push body books out of topK in either half.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { MatterKind } from "../../src/domain/structure/matter-kind.js";
import { log } from "../../src/logging.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import type { Reranker } from "../../src/semantic/reranker.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import {
  type ChunkIndex,
  type FigureIndex,
  type IndexedChunk,
  type LibraryHit,
  SqliteIndexStore,
} from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

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

const reranker = (scores: Record<string, number>): Reranker => ({
  async rerank(_q, passages) {
    return passages.map((p) => scores[p] ?? 0.1);
  },
  async warmup() {},
});

function fakeDeps(vec: LibraryHit[], r?: Reranker): RetrievalDeps {
  const index = {
    searchLibrary: () => vec,
    searchLibraryFts: () => [],
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
    embedder: { embedQuery: async () => tilt(1) } as unknown as RetrievalDeps["embedder"],
    ...(r ? { reranker: r } : {}),
    config: { rerankEnabled: true, semanticFloor: 0.78 },
    log,
  };
}

/** Axis 0 tilted by w towards the last axis: a query on axis 0 ranks larger w higher. */
function tilt(w: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = w;
  v[EMBED_DIM - 1] = 1 - w;
  return l2normalize(v);
}

const lib = (mode: "hybrid" | "vector" | "keyword", topK: number) =>
  ({ scope: "library", libraryId: "L", query: "kiwi", mode, topK }) as const;

describe("confidence after the matter placement (#605 review)", () => {
  it("maxRerank comes from the body tier shown first, not from a weak book placed after it", async () => {
    const vec = [lh(1, "B1", 0.9), lh(2, "BIB2", 0.88, "back_biblio")];
    const r = await retrieve(fakeDeps(vec, reranker({ B1: 0.001, BIB2: 0.99 })), lib("vector", 5));
    expect([r.hits.map((h) => h.hit.bookId), r.maxRerank, r.lowConfidence]).toEqual([[1, 2], 0.001, true]);
  });

  it("a result of only strong front/back matter is still reranked and flagged low-confidence", async () => {
    const vec = [lh(1, "Copyright © 2026. All rights reserved. ISBN 978-1", 0.9986, "back_other")];
    const r = await retrieve(fakeDeps(vec, reranker({})), lib("vector", 5));
    expect([r.reranked, r.maxRerank, r.lowConfidence]).toEqual([true, 0.1, true]);
  });
});

describe("non-body fallbacks never displace body books at topK (#605 review)", () => {
  const ch = (i: number, body: string, w: number, matterKind: MatterKind): IndexedChunk => ({
    body,
    charStart: i * 100,
    charEnd: i * 100 + body.length,
    vector: tilt(w),
    matterKind,
  });

  function store(): SqliteIndexStore {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const book = (id: number, chunks: IndexedChunk[]) =>
      s.replaceBook("L", { bookId: id, title: `Book ${id}`, authors: [] }, chunks);
    // Book 1 holds only an index page, the closest chunk in both halves.
    book(1, [ch(0, "kiwi kiwi kiwi kiwi, 12, 45", 0.99, "back_index")]);
    book(2, [ch(0, "kiwi vines grow on a trellis in a sunny garden", 0.8, "body")]);
    book(3, [ch(0, "kiwi fruit ripens slowly after picking in the autumn months", 0.7, "body")]);
    return s;
  }

  const deps = (s: SqliteIndexStore): RetrievalDeps => ({
    index: s,
    embedder: { embedQuery: async () => tilt(1) } as unknown as RetrievalDeps["embedder"],
    config: { rerankEnabled: true, semanticFloor: 0.78 },
    log,
  });

  it("vector half: topK 2 returns both body books", async () => {
    const r = await retrieve(deps(store()), lib("vector", 2));
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([2, 3]);
  });

  it("keyword half: topK 2 returns both body books", async () => {
    const r = await retrieve(deps(store()), lib("keyword", 2));
    expect(r.hits.map((h) => h.hit.bookId).sort()).toEqual([2, 3]);
  });

  it("with room left, the fallback book follows the body books", async () => {
    const r = await retrieve(deps(store()), lib("vector", 3));
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([2, 3, 1]);
  });
});
