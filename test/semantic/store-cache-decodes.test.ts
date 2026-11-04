// Decode counts of the per-library candidate caches (#370 §Vector cache, from #351): another
// connection's commit re-decodes only the books it touched, a neighbour's close() checkpoint
// re-decodes nothing, and the figure cache is held to the same counts as the chunk cache.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import {
  type BookMeta,
  type IndexedChunk,
  type IndexedFigure,
  SqliteIndexStore,
} from "../../src/semantic/store/index.js";
import { dot, l2normalize } from "../../src/semantic/vector.js";

// Count every BLOB → Float32Array decode: the expensive step the caches exist to avoid.
const decodes = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../src/semantic/vector.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/semantic/vector.js")>();
  return {
    ...real,
    decodeVector: (u8: Uint8Array) => {
      decodes.n++;
      return real.decodeVector(u8);
    },
  };
});

const LIB = "Test_Lib";

/** Unit vector on axis 0 tilted by w, so every book ranks in a fixed order. */
function axis(w: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = w;
  v[EMBED_DIM - 1] = 1 - w;
  return l2normalize(v);
}

const meta = (bookId: number): BookMeta => ({ bookId, title: `Book ${bookId}`, authors: ["A"], lastModified: "v1" });

/** Two embedded chunks per book. */
const chunks = (w: number): IndexedChunk[] => [
  { body: "first half", charStart: 0, charEnd: 10, vector: axis(w) },
  { body: "second half", charStart: 10, charEnd: 21, vector: axis(w - 0.01) },
];

/** One embedded figure per book. */
const figures = (w: number): IndexedFigure[] => [
  { figIndex: 0, page: 1, caption: "diagram", charOffset: 5, format: "pdf", vector: axis(w) },
];

/** Write books 1–4 (book id i on weight 1 - i/10) through `s`. */
function seed(s: SqliteIndexStore): void {
  for (const id of [1, 2, 3, 4]) s.replaceBook(LIB, meta(id), chunks(1 - id / 10), figures(1 - id / 10));
}

/** Run `fn` and return how many vectors it decoded. */
function decoded(fn: () => void): number {
  const before = decodes.n;
  fn();
  return decodes.n - before;
}

const chunkIds = (s: SqliteIndexStore) => s.searchLibrary(LIB, axis(1), 10).map((h) => [h.bookId, h.score]);
const figIds = (s: SqliteIndexStore) => s.searchFigures(LIB, axis(1), 10).map((h) => [h.bookId, h.score]);

describe("candidate cache decode counts across two connections (#370 §Vector cache)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  let a: SqliteIndexStore;
  let b: SqliteIndexStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-cache-decodes-"));
    a = open();
    seed(a);
    b = open();
  });

  afterEach(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("figures: the first search decodes every caption vector once, repeats decode none", () => {
    expect(decoded(() => b.searchFigures(LIB, axis(1), 10))).toBe(4);
    expect(decoded(() => b.searchFigures(LIB, axis(1), 10))).toBe(0);
    expect(decoded(() => b.searchFigures(LIB, axis(1), 10, 2))).toBe(0); // book scope shares the cache
  });

  it("another connection re-indexing one book re-decodes only that book's vectors", () => {
    expect(decoded(() => b.searchLibrary(LIB, axis(1), 10))).toBe(8);
    expect(decoded(() => b.searchFigures(LIB, axis(1), 10))).toBe(4);
    a.replaceBook(LIB, meta(2), chunks(0.95), figures(0.95)); // book 2 moves to the top
    expect(decoded(() => b.searchLibrary(LIB, axis(1), 10))).toBe(2);
    expect(decoded(() => b.searchFigures(LIB, axis(1), 10))).toBe(1);
    expect(b.searchLibrary(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([2, 1, 3, 4]);
    expect(b.searchFigures(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([2, 1, 3, 4]);
  });

  it("another connection deleting a book re-decodes nothing and drops it", () => {
    b.searchLibrary(LIB, axis(1), 10);
    b.searchFigures(LIB, axis(1), 10);
    a.deleteBooks(LIB, [3]);
    expect(decoded(() => b.searchLibrary(LIB, axis(1), 10))).toBe(0);
    expect(decoded(() => b.searchFigures(LIB, axis(1), 10))).toBe(0);
    expect(b.searchLibrary(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([1, 2, 4]);
    expect(b.searchFigures(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([1, 2, 4]);
    expect(b.searchBook(LIB, 3, axis(1), 10)).toEqual([]);
  });

  it("a new book from another connection decodes only its own vectors", () => {
    b.searchLibrary(LIB, axis(1), 10);
    b.searchFigures(LIB, axis(1), 10);
    a.replaceBook(LIB, meta(5), chunks(0.05), figures(0.05));
    expect(decoded(() => b.searchLibrary(LIB, axis(1), 10))).toBe(2);
    expect(decoded(() => b.searchFigures(LIB, axis(1), 10))).toBe(1);
    expect(b.searchLibrary(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([1, 2, 3, 4, 5]);
  });

  it("the neighbour's close() checkpoint triggers no re-decode", () => {
    b.searchLibrary(LIB, axis(1), 10);
    b.searchFigures(LIB, axis(1), 10);
    a.close(); // wal_checkpoint(TRUNCATE) — writes no index rows
    expect(decoded(() => b.searchLibrary(LIB, axis(1), 10))).toBe(0);
    expect(decoded(() => b.searchFigures(LIB, axis(1), 10))).toBe(0);
    a = open(); // afterEach closes it again
  });

  it("after a mix of outside writes the warm cache ranks exactly like a cold one", () => {
    b.searchLibrary(LIB, axis(1), 10);
    b.searchFigures(LIB, axis(1), 10);
    a.replaceBook(LIB, meta(2), chunks(0.95), figures(0.95));
    a.deleteBooks(LIB, [4]);
    a.replaceBook(LIB, meta(6), chunks(0.55), figures(0.55));
    const cold = open();
    try {
      expect(chunkIds(b)).toEqual(chunkIds(cold));
      expect(figIds(b)).toEqual(figIds(cold));
    } finally {
      cold.close();
    }
  });
});

describe("candidate cache decode counts on own writes and ':memory:' (#370 §Vector cache)", () => {
  // ":memory:" has no WAL and only one connection, so data_version never moves: own writes must
  // still refresh the cache, and only for the books they touched.
  let s: SqliteIndexStore;

  beforeEach(() => {
    s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    seed(s);
  });

  afterEach(() => s.close());

  it("an own re-index re-decodes only the written book and serves its new vectors", () => {
    expect(decoded(() => s.searchLibrary(LIB, axis(1), 10))).toBe(8);
    expect(decoded(() => s.searchFigures(LIB, axis(1), 10))).toBe(4);
    s.replaceBook(LIB, meta(3), chunks(0.99), figures(0.99));
    expect(decoded(() => s.searchLibrary(LIB, axis(1), 10))).toBe(2);
    expect(decoded(() => s.searchFigures(LIB, axis(1), 10))).toBe(1);
    expect(s.searchLibrary(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([3, 1, 2, 4]);
    expect(s.searchFigures(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([3, 1, 2, 4]);
  });

  it("an own re-index of the same book twice in a row still serves the last vectors", () => {
    s.searchLibrary(LIB, axis(1), 10);
    s.replaceBook(LIB, meta(4), chunks(0.98), figures(0.98));
    s.replaceBook(LIB, meta(4), chunks(0.97), figures(0.97)); // same millisecond is likely here
    expect(decoded(() => s.searchLibrary(LIB, axis(1), 10))).toBe(2);
    expect(s.searchLibrary(LIB, axis(1), 1)[0]!.score).toBeCloseTo(dot(axis(0.97), axis(1)), 6);
  });

  it("an own delete re-decodes nothing and drops the book", () => {
    s.searchLibrary(LIB, axis(1), 10);
    s.searchFigures(LIB, axis(1), 10);
    s.deleteBooks(LIB, [1]);
    expect(decoded(() => s.searchLibrary(LIB, axis(1), 10))).toBe(0);
    expect(decoded(() => s.searchFigures(LIB, axis(1), 10))).toBe(0);
    expect(s.searchLibrary(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([2, 3, 4]);
    expect(s.searchFigures(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([2, 3, 4]);
  });

  it("a meta-only refresh re-decodes only that book", () => {
    s.searchLibrary(LIB, axis(1), 10);
    const spans = [
      { charStart: 0, charEnd: 10, body: "first half" },
      { charStart: 10, charEnd: 21, body: "second half" },
    ];
    expect(s.refreshBookMeta(LIB, { ...meta(2), title: "Renamed" }, { spans, frontMatterEnd: 0 })).toBe(true);
    expect(decoded(() => s.searchLibrary(LIB, axis(1), 10))).toBe(2); // indexed_at moves, so the book reloads once;
    expect(s.searchLibrary(LIB, axis(1), 10).map((h) => h.bookId)).toEqual([1, 2, 3, 4]);
  });
});
