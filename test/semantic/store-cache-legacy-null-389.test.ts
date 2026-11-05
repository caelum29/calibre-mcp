// #389 §Vector cache (from #374): a legacy `books` row with embedded_chunks NULL (written before
// #197 added the column) gets a stable per-book stamp, so another connection's commit to a
// DIFFERENT book never re-decodes it; rewriting it (NULL → a count) re-decodes exactly that book.

import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type BookMeta, type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { encodeVector, l2normalize } from "../../src/semantic/vector.js";

// Count every BLOB → Float32Array decode: the expensive step the cache exists to avoid.
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

/** Unit vector on axis 0 tilted by w, so books rank in a fixed order. */
function axis(w: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = w;
  v[EMBED_DIM - 1] = 1 - w;
  return l2normalize(v);
}

const meta = (bookId: number): BookMeta => ({ bookId, title: `Book ${bookId}`, authors: ["A"], lastModified: "v1" });
const chunks = (w: number): IndexedChunk[] => [
  { body: "first half", charStart: 0, charEnd: 10, vector: axis(w) },
  { body: "second half", charStart: 10, charEnd: 21, vector: axis(w) },
];

function decoded(fn: () => void): number {
  const before = decodes.n;
  fn();
  return decodes.n - before;
}

describe("vector cache with a legacy embedded_chunks NULL row (#389 §Vector cache)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  let a: SqliteIndexStore;
  let b: SqliteIndexStore;
  const ranked = () => b.searchLibrary(LIB, axis(1), 10).map((h) => h.bookId);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-legacy-null-"));
    a = open();
    a.replaceBook(LIB, meta(1), chunks(0.9));
    a.replaceBook(LIB, meta(2), chunks(0.8));
    // Book 1 becomes a pre-#197 row: the column exists (migration ran) but was never filled.
    const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
    raw.exec("UPDATE books SET embedded_chunks = NULL WHERE book_id = 1");
    raw.close();
    b = open();
  });

  afterEach(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should_decode_the_legacy_book_once_and_hit_the_cache_after", () => {
    expect([decoded(() => ranked()), decoded(() => ranked())]).toEqual([4, 0]);
  });

  it("should_not_re_decode_the_legacy_book_when_another_book_is_committed", () => {
    ranked(); // warm
    a.replaceBook(LIB, meta(3), chunks(0.7));
    let ids: number[] = [];
    const n = decoded(() => {
      ids = ranked();
    });
    expect({ n, ids }).toEqual({ n: 2, ids: [1, 2, 3] });
  });

  it("should_re_decode_exactly_the_legacy_book_when_it_is_rewritten", () => {
    ranked(); // warm
    a.replaceBook(LIB, meta(1), chunks(0.6)); // embedded_chunks NULL → 2, new vectors rank it last
    let ids: number[] = [];
    const n = decoded(() => {
      ids = ranked();
    });
    expect({ n, ids }).toEqual({ n: 2, ids: [2, 1] });
  });

  // An older-version writer leaves the row NULL: it bumps indexed_at and swaps the vectors, never
  // filling embedded_chunks. The stamp still changes, so the cache must not keep the old vectors.
  it("should_re_decode_the_legacy_book_when_an_older_writer_rewrites_it_and_leaves_it_NULL", () => {
    ranked(); // warm
    const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
    raw.prepare("UPDATE embeddings SET vector = ? WHERE book_id = 1").run(encodeVector(axis(0.6)));
    raw.exec("UPDATE books SET indexed_at = '2099-01-01T00:00:00.000Z' WHERE book_id = 1");
    const stillNull = raw.prepare("SELECT embedded_chunks FROM books WHERE book_id = 1").get();
    raw.close();
    let ids: number[] = [];
    const n = decoded(() => {
      ids = ranked();
    });
    expect({ stillNull, n, ids }).toEqual({ stillNull: { embedded_chunks: null }, n: 2, ids: [2, 1] });
  });
});

// A pre-#197 FILE (no embedded_chunks column at all), peeked read-only so nothing migrates it:
// booksMissingVectors must fall back to counting each book's embeddings.
describe("booksMissingVectors on a file without the embedded_chunks column (#389 §Vector cache)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-pre197-"));
    const w = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    w.replaceBook(LIB, meta(1), chunks(0.9)); // 2 chunks, 2 vectors
    w.replaceBook(LIB, meta(2), [
      { body: "keyword only", charStart: 0, charEnd: 12 },
      { body: "no vectors", charStart: 12, charEnd: 22 },
    ]);
    w.close();
    const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
    raw.exec("ALTER TABLE books DROP COLUMN embedded_chunks"); // the older DDL
    raw.close();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("should_count_only_the_book_without_embeddings", () => {
    const r = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    try {
      expect(r.booksMissingVectors(LIB)).toBe(1);
    } finally {
      r.close();
    }
  });
});
