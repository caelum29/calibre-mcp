// The metadata list (#631, query side): library hybrid fuses the book_metadata ranking as a third
// RRF list with its own weight, 0 by default. A book that entered through that list alone is shown
// and reranked by its metadata row; a book with a body candidate keeps the body. Retrieve-level
// cases run on fake halves; the store cases run on a real in-memory SqliteIndexStore.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import type { Reranker } from "../../src/semantic/reranker.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import {
  type BookMetadataIndex,
  type ChunkIndex,
  type FigureIndex,
  type LibraryHit,
  SqliteIndexStore,
} from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

/** A chunk hit of one book. */
const lh = (bookId: number, body: string, score: number): LibraryHit => ({
  bookId,
  chunkId: bookId * 10,
  title: `Book ${bookId}`,
  authors: [],
  score,
  snippet: body,
  body,
  charStart: bookId * 100,
  charEnd: bookId * 100 + 50,
});

/** A metadata-row hit of one book, the shape the store returns: row text as body, blurb as snippet. */
const mh = (bookId: number, blurb: string, score: number): LibraryHit => ({
  bookId,
  chunkId: 0,
  title: `Book ${bookId}`,
  authors: [],
  score,
  snippet: blurb,
  body: `Book ${bookId}\n\n${blurb}`,
  charStart: 0,
  charEnd: 0,
  from: "description",
});

/** Reranker scoring each passage by its text (unknown = 0.1) and recording every call. */
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

/** Fake halves plus a metadata list; `metaCalls` counts searchLibraryMetadata calls. */
function deps(vec: LibraryHit[], kw: LibraryHit[], meta: LibraryHit[] | undefined, reranker?: Reranker) {
  const metaCalls: number[] = [];
  const base = {
    searchLibrary: () => vec,
    searchLibraryFts: () => kw,
    searchBook: () => [],
    searchBookFts: () => [],
    chunkAt: () => undefined,
    searchFigures: () => [],
    searchFiguresFts: () => [],
    figureCount: () => 0,
    figuresInSpan: () => [],
  } satisfies ChunkIndex & FigureIndex;
  const metadata = {
    searchLibraryMetadata: (_l: string, _q: Float32Array, k: number) => {
      metaCalls.push(k);
      return meta ?? [];
    },
  } satisfies BookMetadataIndex;
  const d: RetrievalDeps = {
    index: meta === undefined ? base : { ...base, ...metadata },
    embedder: { embedQuery: async () => new Float32Array(EMBED_DIM) } as unknown as RetrievalDeps["embedder"],
    ...(reranker ? { reranker } : {}),
    config: { rerankEnabled: true, semanticFloor: 0.78 },
    log,
  };
  return { d, metaCalls };
}

const lib = (mode: "hybrid" | "vector" | "keyword" = "hybrid", topK = 5) =>
  ({ scope: "library", libraryId: "L", query: "zebra", mode, topK }) as const;

const brief = (r: { hit: LibraryHit; cosine?: number }) => [r.hit.bookId, r.hit.from ?? "text", r.cosine];

describe("metadata list in library hybrid fusion (#631)", () => {
  it("adds a metadata-only book after the body books at weight 1, shown by its row, with no cosine", async () => {
    const { d } = deps([lh(1, "v1", 0.8)], [lh(1, "v1", -5)], [mh(2, "blurb two", 0.9), mh(1, "blurb one", 0.7)]);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    expect(r.hits.map(brief)).toEqual([
      [1, "text", 0.8],
      [2, "description", undefined],
    ]);
  });

  it("lets a metadata match lift a book above one with the same body rank", async () => {
    // book 1 vector #1 (1/61); book 2 vector #2 + metadata #1 (1/62 + 1/61)
    const { d } = deps([lh(1, "v1", 0.8), lh(2, "v2", 0.79)], [], [mh(2, "blurb two", 0.9)]);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    expect(r.hits.map((h) => [h.hit.bookId, h.hit.from ?? "text"])).toEqual([
      [2, "text"],
      [1, "text"],
    ]);
  });

  it("scales the metadata contribution by its weight: at 0.01 it no longer lifts book 2", async () => {
    // book 2: 1/62 + 0.01/61 = 0.016293 < book 1: 1/61 = 0.016393
    const { d } = deps([lh(1, "v1", 0.8), lh(2, "v2", 0.79)], [], [mh(2, "blurb two", 0.9)]);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 0.01] });
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([1, 2]);
  });

  it("by default never asks the index for the metadata list", async () => {
    const { d, metaCalls } = deps([lh(1, "v1", 0.8)], [lh(1, "v1", -5)], [mh(2, "blurb two", 0.9)]);
    await retrieve(d, lib());
    expect(metaCalls).toEqual([]);
  });

  it("reads a two-entry rrfWeights as metadata weight 0, not 1", async () => {
    const { d, metaCalls } = deps([lh(1, "v1", 0.8)], [], [mh(2, "blurb two", 0.9)]);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1] });
    expect([metaCalls, r.hits.map((h) => h.hit.bookId)]).toEqual([[], [1]]);
  });

  it("returns the same hits by default as an index with no metadata list at all", async () => {
    const vec = [lh(1, "v1", 0.8), lh(2, "v2", 0.79)];
    const kw = [lh(3, "k3", -5)];
    const withMeta = await retrieve(deps(vec, kw, [mh(4, "blurb four", 0.99)]).d, lib());
    const without = await retrieve(deps(vec, kw, undefined).d, lib());
    expect(withMeta).toEqual(without);
  });

  it("uses the metadata list in hybrid only: vector and keyword modes never ask for it", async () => {
    const v = deps([lh(1, "v1", 0.8)], [lh(1, "v1", -5)], [mh(2, "blurb two", 0.9)]);
    await retrieve(v.d, lib("vector"), { rrfWeights: [1, 1, 1] });
    await retrieve(v.d, lib("keyword"), { rrfWeights: [1, 1, 1] });
    expect(v.metaCalls).toEqual([]);
  });

  it("asks for a 50-book metadata pool, like each half", async () => {
    const { d, metaCalls } = deps([lh(1, "v1", 0.8)], [], [mh(2, "blurb two", 0.9)]);
    await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    expect(metaCalls).toEqual([50]);
  });

  it("an index without the metadata port fuses as before even at weight 1", async () => {
    const { d } = deps([lh(1, "v1", 0.8)], [lh(2, "k2", -5)], undefined);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    expect(r.hits.map((h) => h.hit.bookId)).toEqual([1, 2]);
  });
});

describe("metadata list: rerank input and display (#631)", () => {
  it("reranks a metadata-only book on its row text and a book with a body candidate on its body", async () => {
    const { reranker, calls } = bodyReranker({});
    const { d } = deps([lh(1, "v1", 0.8)], [], [mh(1, "blurb one", 0.95), mh(2, "blurb two", 0.9)], reranker);
    await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    expect(calls).toEqual([["v1", "Book 2\n\nblurb two"]]);
  });

  it("lets a metadata-only book win the rerank on its row text", async () => {
    const { reranker } = bodyReranker({ v1: 0.2, "Book 2\n\nblurb two": 0.9 });
    const { d } = deps([lh(1, "v1", 0.8)], [], [mh(2, "blurb two", 0.9)], reranker);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    expect(r.hits.map((h) => [h.hit.bookId, h.hit.from ?? "text", h.rerankScore])).toEqual([
      [2, "description", 0.9],
      [1, "text", 0.2],
    ]);
  });

  it("shows the blurb as a description hit's snippet, with no snippet offset", async () => {
    const { d } = deps([], [], [mh(2, "A short blurb about zebras.", 0.9)]);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    const h = r.hits[0]!.hit;
    expect([h.snippet, h.snippetStart, h.from]).toEqual(["A short blurb about zebras.", undefined, "description"]);
  });

  it("cuts a long blurb to the snippet window around the query term", async () => {
    const blurb = `${"Filler words about horses. ".repeat(40)}The zebra stripes section.`;
    const { d } = deps([], [], [mh(2, blurb, 0.9)]);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    const s = r.hits[0]!.hit.snippet;
    expect([s.includes("zebra"), s.length < blurb.length]).toEqual([true, true]);
  });

  it("records the fused rank of a description hit but no chunk source", async () => {
    const { d } = deps([lh(1, "v1", 0.8)], [], [mh(2, "blurb two", 0.9)]);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    expect(r.hits[1]!.provenance).toEqual({ fusedRank: 2, rerankPool: false });
  });

  it("keeps maxScore to chunk cosines: a metadata cosine never speaks for the floor", async () => {
    const { d } = deps([lh(1, "v1", 0.5)], [], [mh(2, "blurb two", 0.99)]);
    const r = await retrieve(d, lib(), { rrfWeights: [1, 1, 1] });
    expect([r.maxScore, r.lowConfidence]).toEqual([0.5, true]);
  });
});

// ── store: the metadata ranking over book_metadata vectors ───────────────────────────────

const LIB = "Test_Lib";

function axis(i: number, j?: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  if (j !== undefined) v[j] = 1;
  return l2normalize(v);
}

/** Books 1–4, one chunk each; metadata rows with vectors at falling cosine vs axis 0, book 4 without a vector. */
function store(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  const rows: Array<[number, string, number, Float32Array | undefined]> = [
    [1, "Alpha\nAnn\n\nAlpha blurb.", 12, axis(1)],
    [2, "Beta\nBob\n\nBeta blurb.", 11, axis(0)],
    [3, "Gamma\nCy", 0, axis(0, 1)],
    [4, "Delta\nDee\n\nDelta blurb.", 12, undefined],
  ];
  for (const [bookId, text, blurbChars, vector] of rows) {
    const title = text.split("\n")[0]!;
    s.replaceBook(
      LIB,
      { bookId, title, authors: [text.split("\n")[1]!] },
      [{ body: `${title} body`, charStart: 0, charEnd: 9, vector: axis(5) }],
      [],
      { metadata: { text, blurbChars, ...(vector ? { vector } : {}) } },
    );
  }
  return s;
}

describe("SqliteIndexStore.searchLibraryMetadata (#631)", () => {
  it("ranks metadata rows by cosine, skipping rows without a vector", () => {
    const hits = store().searchLibraryMetadata(LIB, axis(0), 10);
    expect(hits.map((h) => [h.bookId, Number(h.score.toFixed(4))])).toEqual([
      [2, 1],
      [3, 0.7071],
      [1, 0],
    ]);
  });

  it("returns a description hit: row text as body, blurb as snippet, no location", () => {
    const [top] = store().searchLibraryMetadata(LIB, axis(0), 1);
    expect(top).toEqual({
      bookId: 2,
      chunkId: 0,
      title: "Beta",
      authors: ["Bob"],
      score: 1,
      snippet: "Beta blurb.",
      body: "Beta\nBob\n\nBeta blurb.",
      charStart: 0,
      charEnd: 0,
      from: "description",
    });
  });

  it("shows the whole row as the snippet of a book with no blurb", () => {
    const hits = store().searchLibraryMetadata(LIB, axis(0), 2);
    expect(hits[1]!.snippet).toBe("Gamma\nCy");
  });

  it("cuts at k and restricts to the allowed books before ranking", () => {
    const hits = store().searchLibraryMetadata(LIB, axis(0), 1, new Set([1, 3]));
    expect(hits.map((h) => h.bookId)).toEqual([3]);
  });

  it("breaks equal cosines by ascending book id", () => {
    const hits = store().searchLibraryMetadata(LIB, axis(7), 10);
    expect(hits.map((h) => h.bookId)).toEqual([1, 2, 3]);
  });

  it("returns nothing for a library without metadata rows", () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    s.replaceBook(LIB, { bookId: 9, title: "T", authors: [] }, [
      { body: "b", charStart: 0, charEnd: 1, vector: axis(0) },
    ]);
    expect(s.searchLibraryMetadata(LIB, axis(0), 10)).toEqual([]);
  });
});
