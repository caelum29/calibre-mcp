// #618 through the store: searchLibrary/searchBook on a seeded random library return exactly what
// today's algorithm returns over the same embeddings rows (the oracle reads them straight from the
// index file), cold and after every kind of refresh, and a refresh reached through book scope
// decodes only the touched books.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { type Candidate, decodeVector } from "../../src/semantic/vector.js";
import { mulberry32 } from "../eval/retrieval/stats.js";
import {
  oracleBook,
  oracleLibrary,
  randomUnit,
  type SeededBook,
  seededLibrary,
  seededQueries,
} from "./vector-oracle-fixture.js";

// Count BLOB → Float32Array decodes, as store-cache-decodes.test.ts does.
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

const chunksOf = (vectors: Float32Array[]): IndexedChunk[] =>
  vectors.map((vector, i) => ({ body: `chunk ${i}`, charStart: i * 10, charEnd: i * 10 + 9, vector }));

const write = (s: SqliteIndexStore, b: SeededBook) =>
  s.replaceBook(LIB, { bookId: b.bookId, title: `Book ${b.bookId}`, authors: ["A"] }, chunksOf(b.vectors));

/** Run `fn` and return how many vectors it decoded. */
function decoded(fn: () => void): number {
  const before = decodes.n;
  fn();
  return decodes.n - before;
}

describe("store vector search equals today's algorithm (#618)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  let a: SqliteIndexStore; // writer
  let b: SqliteIndexStore; // reader under test, its cache warmed before the writes
  const books = seededLibrary(42);
  const queries = seededQueries(42, books);
  const ids = books.map((x) => x.bookId);

  /** Every embeddings row of the index file, decoded — the oracle's candidate set. */
  function oracleCandidates(): Candidate[] {
    const db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
    try {
      const rows = db.prepare("SELECT chunk_id, book_id, vector FROM embeddings").all();
      return rows.map((r) => ({
        chunkId: Number(r.chunk_id),
        bookId: Number(r.book_id),
        vector: decodeVector(r.vector as Uint8Array),
      }));
    } finally {
      db.close();
    }
  }

  /** b, a cold store and the oracle agree on both scopes for every query and several k. */
  function expectOracle(s: SqliteIndexStore): void {
    const cands = oracleCandidates();
    const present = [...new Set(cands.map((c) => c.bookId))];
    const allow = new Set(present.filter((_, i) => i % 4 !== 2));
    const lib = (k: number, q: Float32Array, al?: ReadonlySet<number>) =>
      s.searchLibrary(LIB, q, k, al).map((h) => [h.bookId, h.chunkId, h.score]);
    const want = (k: number, q: Float32Array, al?: ReadonlySet<number>) =>
      oracleLibrary(q, cands, k, al).map((h) => [h.bookId, h.chunkId, h.score]);
    for (const q of queries) {
      for (const k of [1, 7, 50, 200]) {
        expect(lib(k, q)).toStrictEqual(want(k, q));
        expect(lib(k, q, allow)).toStrictEqual(want(k, q, allow));
      }
      for (const id of present.slice(0, 12)) {
        expect(s.searchBook(LIB, id, q, 6).map((h) => [h.chunkId, h.score])).toStrictEqual(
          oracleBook(q, cands, id, 6).map((h) => [h.chunkId, h.score]),
        );
      }
    }
  }

  /** b's results for both scopes equal a cold store's, offsets included. */
  function expectCold(): void {
    const cold = open();
    try {
      for (const q of queries) {
        const strip = (s: SqliteIndexStore) =>
          s.searchLibrary(LIB, q, 200).map((h) => [h.bookId, h.chunkId, h.charStart, h.score]);
        expect(strip(b)).toStrictEqual(strip(cold));
        for (const id of [ids[0]!, ids[5]!, ids[17]!, 1]) {
          const book = (s: SqliteIndexStore) =>
            s.searchBook(LIB, id, q, 10).map((h) => [h.chunkId, h.charStart, h.score]);
          expect(book(b)).toStrictEqual(book(cold));
        }
      }
    } finally {
      cold.close();
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-oracle-618-"));
    a = open();
    for (const book of books) write(a, book);
    b = open();
    b.searchLibrary(LIB, queries[0]!, 5); // warm b's cache
  });

  afterEach(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("cold: both scopes, with and without allow, equal the oracle exactly", () => {
    expectOracle(b);
  });

  it("after another connection rewrites a book: equals the oracle and a cold store", () => {
    const rand = mulberry32(3);
    write(a, { bookId: ids[5]!, vectors: [randomUnit(rand), queries[3]!.slice(), randomUnit(rand)] });
    expectOracle(b);
    expectCold();
  });

  it("after an own rewrite: equals the oracle and a cold store", () => {
    write(b, { bookId: ids[17]!, vectors: [queries[4]!.slice(), queries[4]!.slice()] });
    expectOracle(b);
    expectCold();
  });

  it("after a delete and a new book: equals the oracle and a cold store", () => {
    a.deleteBooks(LIB, [ids[0]!]);
    write(a, { bookId: 1, vectors: [queries[3]!.slice()] }); // new, below every seeded id, ties a stored vector
    expectOracle(b);
    expectCold();
  });
});

describe("refresh reached through book scope decodes only the touched books (#618)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  let a: SqliteIndexStore;
  let b: SqliteIndexStore;
  const books = seededLibrary(9, 8, 4);
  const rand = mulberry32(17);
  const total = books.reduce((n, x) => n + x.vectors.length, 0);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-oracle-618-decodes-"));
    a = open();
    for (const book of books) write(a, book);
    b = open();
  });

  afterEach(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a cold book-scope search decodes the whole library once, then nothing", () => {
    const q = randomUnit(rand);
    expect(decoded(() => b.searchBook(LIB, books[2]!.bookId, q, 5))).toBe(total);
    expect(decoded(() => b.searchBook(LIB, books[3]!.bookId, q, 5))).toBe(0);
    expect(decoded(() => b.searchLibrary(LIB, q, 5))).toBe(0);
  });

  it("another connection's rewrite: the next book-scope search decodes only that book", () => {
    const q = randomUnit(rand);
    b.searchLibrary(LIB, q, 5);
    write(a, { bookId: books[1]!.bookId, vectors: [q.slice(), randomUnit(rand), randomUnit(rand)] });
    expect(decoded(() => b.searchBook(LIB, books[4]!.bookId, q, 5))).toBe(3);
    expect(b.searchBook(LIB, books[1]!.bookId, q, 1).map((h) => h.charStart)).toEqual([0]);
  });

  it("an own rewrite: the next book-scope search decodes only that book", () => {
    const q = randomUnit(rand);
    b.searchBook(LIB, books[0]!.bookId, q, 5);
    write(b, { bookId: books[6]!.bookId, vectors: [randomUnit(rand), q.slice()] });
    expect(decoded(() => b.searchBook(LIB, books[6]!.bookId, q, 5))).toBe(2);
    expect(b.searchBook(LIB, books[6]!.bookId, q, 1).map((h) => h.charStart)).toEqual([10]);
  });

  it("a delete then a new book: book scope decodes only the new book's vectors", () => {
    const q = randomUnit(rand);
    b.searchBook(LIB, books[0]!.bookId, q, 5);
    a.deleteBooks(LIB, [books[3]!.bookId]);
    write(a, { bookId: 999, vectors: [q.slice()] });
    expect(decoded(() => b.searchBook(LIB, 999, q, 5))).toBe(1);
    expect(b.searchBook(LIB, books[3]!.bookId, q, 5)).toEqual([]);
  });
});
