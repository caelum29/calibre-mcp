// #618: the packed chunk matrix (one flat Float32Array, rows grouped by book) must rank exactly
// like today's algorithm — same books, chunks and scores, compared exactly — and a refresh that
// copies unchanged books must build the same matrix a cold pack builds.

import { describe, expect, it } from "vitest";
import { EMBED_DIM } from "../../src/semantic/model.js";
import {
  bookTop,
  type ChunkMatrix,
  libraryTop,
  MatrixWriter,
  mergeMatrix,
} from "../../src/semantic/store/chunk-matrix.js";
import { type Candidate, dot, dotAt, l2normalize } from "../../src/semantic/vector.js";
import { mulberry32 } from "../eval/retrieval/stats.js";
import {
  oracleBook,
  oracleLibrary,
  randomUnit,
  type SeededBook,
  seededLibrary,
  seededQueries,
} from "./vector-oracle-fixture.js";

/** Candidates of a seeded library with chunk ids interleaved across books (as rowids are). */
function candidatesOf(books: SeededBook[]): Candidate[] {
  const out: Candidate[] = [];
  let id = 100;
  const longest = Math.max(...books.map((b) => b.vectors.length));
  for (let c = 0; c < longest; c++) {
    for (const b of books) {
      const v = b.vectors[c];
      if (v) out.push({ chunkId: id++, bookId: b.bookId, vector: v });
    }
  }
  return out;
}

/** Pack candidates the way the loader does: per-book counts first, then rows in chunk-id order. */
function matrixOf(cands: Candidate[]): ChunkMatrix {
  const counts = new Map<number, number>();
  for (const c of cands) counts.set(c.bookId, (counts.get(c.bookId) ?? 0) + 1);
  const w = new MatrixWriter(counts);
  for (const c of [...cands].sort((x, y) => x.chunkId - y.chunkId)) w.place(c.bookId, c.chunkId, c.vector);
  return w.finish();
}

/** A unit vector on one axis. */
function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return v;
}

const hits = (xs: { bookId: number; chunkId: number; score: number }[]) =>
  xs.map((h) => [h.bookId, h.chunkId, h.score]);

describe("dotAt (#618)", () => {
  it("returns the bit-identical double dot() returns for the same row", () => {
    const rand = mulberry32(7);
    const rows = [randomUnit(rand), randomUnit(rand), randomUnit(rand)];
    const flat = new Float32Array(rows.length * EMBED_DIM);
    rows.forEach((r, i) => flat.set(r, i * EMBED_DIM));
    const q = randomUnit(rand);
    expect(rows.map((_, i) => dotAt(q, flat, i * EMBED_DIM))).toStrictEqual(rows.map((r) => dot(q, r)));
  });
});

describe("MatrixWriter (#618)", () => {
  it("groups rows by ascending book id with rows in ascending chunk id", () => {
    const m = matrixOf([
      { chunkId: 1, bookId: 9, vector: axis(1) },
      { chunkId: 2, bookId: 4, vector: axis(2) },
      { chunkId: 3, bookId: 9, vector: axis(3) },
      { chunkId: 5, bookId: 4, vector: axis(5) },
    ]);
    expect([...m.bookIds]).toEqual([4, 9]);
    expect([...m.bookStart]).toEqual([0, 2, 4]);
    expect([...m.chunkIds]).toEqual([2, 5, 1, 3]);
    expect(m.vectors[2 * EMBED_DIM + 1]).toBe(1); // row 2 = chunk 1 = axis(1)
  });

  it("refuses a row whose chunk id is not above the book's previous row", () => {
    const w = new MatrixWriter(new Map([[1, 2]]));
    w.place(1, 8, axis(0));
    expect(() => w.place(1, 7, axis(1))).toThrow(/ascending chunk id/);
  });

  it("refuses to finish while a book still has unfilled rows", () => {
    const w = new MatrixWriter(new Map([[1, 2]]));
    w.place(1, 8, axis(0));
    expect(() => w.finish()).toThrow(/rows/);
  });

  it("refuses a row for a book it has no slot for", () => {
    const w = new MatrixWriter(new Map([[1, 1]]));
    expect(() => w.place(2, 8, axis(0))).toThrow(/book 2/);
  });
});

describe("libraryTop / bookTop equal today's algorithm on a seeded library (#618)", () => {
  for (const seed of [1, 2, 3]) {
    const books = seededLibrary(seed);
    const cands = candidatesOf(books);
    const m = matrixOf(cands);
    const queries = seededQueries(seed, books);
    const allow = new Set(books.filter((_, i) => i % 3 !== 1).map((b) => b.bookId));

    it(`seed ${seed}: library scope, k ∈ {1, 3, 10, 55, 500}, with and without allow`, () => {
      for (const q of queries) {
        for (const k of [1, 3, 10, 55, 500]) {
          expect(hits(libraryTop(m, q, k))).toStrictEqual(hits(oracleLibrary(q, cands, k)));
          expect(hits(libraryTop(m, q, k, allow))).toStrictEqual(hits(oracleLibrary(q, cands, k, allow)));
        }
      }
    });

    it(`seed ${seed}: book scope, every book, k ∈ {1, 5, 100}`, () => {
      for (const q of queries.slice(0, 2).concat(queries.slice(3))) {
        for (const b of books) {
          for (const k of [1, 5, 100]) {
            expect(hits(bookTop(m, b.bookId, q, k))).toStrictEqual(hits(oracleBook(q, cands, b.bookId, k)));
          }
        }
      }
    });
  }

  it("the seeded library really has tied best scores across books", () => {
    const books = seededLibrary(1);
    const cands = candidatesOf(books);
    const q = seededQueries(1, books)[3]!;
    const scores = oracleLibrary(q, cands, 500).map((h) => h.score);
    expect(new Set(scores).size).toBeLessThan(scores.length);
  });
});

describe("tie order (#618)", () => {
  const v = l2normalize(Float32Array.from({ length: EMBED_DIM }, (_, i) => (i === 0 ? 1 : 0)));

  it("two books with equal best scores: the lower book id comes first", () => {
    const m = matrixOf([
      { chunkId: 1, bookId: 7, vector: v },
      { chunkId: 2, bookId: 3, vector: v },
    ]);
    expect(libraryTop(m, v, 2).map((h) => h.bookId)).toEqual([3, 7]);
  });

  it("one book with two chunks of equal best score: the lower chunk id is the book's chunk", () => {
    const m = matrixOf([
      { chunkId: 4, bookId: 1, vector: axis(5) },
      { chunkId: 6, bookId: 1, vector: v },
      { chunkId: 9, bookId: 1, vector: v },
    ]);
    expect(libraryTop(m, v, 1).map((h) => h.chunkId)).toEqual([6]);
  });

  it("book scope with equal scores: ascending chunk id", () => {
    const m = matrixOf([
      { chunkId: 12, bookId: 1, vector: v },
      { chunkId: 5, bookId: 1, vector: v },
      { chunkId: 8, bookId: 1, vector: v },
    ]);
    expect(bookTop(m, 1, v, 3).map((h) => h.chunkId)).toEqual([5, 8, 12]);
  });

  it("an allowed and a disallowed book tie: only the allowed one is returned", () => {
    const m = matrixOf([
      { chunkId: 1, bookId: 2, vector: v },
      { chunkId: 2, bookId: 5, vector: v },
    ]);
    expect(libraryTop(m, v, 5, new Set([5])).map((h) => [h.bookId, h.chunkId])).toEqual([[5, 2]]);
  });

  it("an empty allow set returns nothing; a book unknown to bookTop returns nothing", () => {
    const m = matrixOf([{ chunkId: 1, bookId: 2, vector: v }]);
    expect(libraryTop(m, v, 5, new Set())).toEqual([]);
    expect(bookTop(m, 99, v, 5)).toEqual([]);
  });
});

describe("mergeMatrix builds what a cold pack builds (#618)", () => {
  const books = seededLibrary(11, 20, 6);
  const cands = candidatesOf(books);
  const ids = books.map((b) => b.bookId);
  const rand = mulberry32(5);
  const rewrite = (bookId: number, firstChunk: number, n: number): Candidate[] =>
    Array.from({ length: n }, (_, i) => ({ chunkId: firstChunk + i, bookId, vector: randomUnit(rand) }));

  it("rewrite of one book, delete of another, a new book, and a stale id with no rows left", () => {
    const old = matrixOf(cands);
    const rewritten = rewrite(ids[4]!, 5000, 3);
    const added = rewrite(1, 6000, 2); // below every seeded id: merges in front
    const stale = new Set([ids[4]!, ids[9]!, 1, 424242]);
    const kept = cands.filter((c) => !stale.has(c.bookId));
    const fresh = matrixOf([...rewritten, ...added]);
    const merged = mergeMatrix(old, stale, fresh);
    const cold = matrixOf([...kept, ...rewritten, ...added]);
    expect(merged.bookIds).toStrictEqual(cold.bookIds);
    expect(merged.bookStart).toStrictEqual(cold.bookStart);
    expect(merged.chunkIds).toStrictEqual(cold.chunkIds);
    expect(merged.vectors).toStrictEqual(cold.vectors);
    expect([...merged.bookIndex]).toStrictEqual([...cold.bookIndex]);
  });

  it("an empty stale set and an empty fresh matrix copy the old matrix as is", () => {
    const old = matrixOf(cands);
    const merged = mergeMatrix(old, new Set(), matrixOf([]));
    expect(merged.chunkIds).toStrictEqual(old.chunkIds);
    expect(merged.vectors).toStrictEqual(old.vectors);
  });
});
