// Ranking-equivalence guard for the FTS-first (MATERIALIZED CTE) rewrite of book-scope and
// bundle-restricted keyword search: the rewrite is a query-plan fix only, so it must return exactly the rows
// and bm25 scores the old JOIN shape returned. The old SQL is run verbatim on the same file.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { stemText } from "../../src/semantic/stem.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Plan_Lib";

// Pre-rewrite SQL, kept verbatim (weights 1.0/1.0/0.5 as in store.ts).
const LEGACY_BOOK_FTS = `SELECT c.id AS chunk_id, bm25(chunk_fts, 1.0, 1.0, 0.5) AS score
  FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
  WHERE chunk_fts MATCH ? AND c.book_id = ? ORDER BY score LIMIT ?`;

const LEGACY_ALLOW_FTS = `SELECT c.id AS chunk_id, c.book_id, bm25(chunk_fts, 1.0, 1.0, 0.5) AS score
  FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
  WHERE chunk_fts MATCH ? AND c.book_id IN (SELECT value FROM json_each(?))
  ORDER BY score LIMIT ?`;

function vec(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i % EMBED_DIM] = 1;
  return l2normalize(v);
}

// Same quoting as store.ts ftsMatch (private there): quoted tokens OR-ed together.
function ftsMatch(stemmed: string): string {
  return stemmed
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" OR ");
}

const VOCAB_EN = ["transaction", "lock", "isolation", "index", "query", "planner", "commit", "rollback"];
const VOCAB_RU = ["транзакция", "блокировка", "изоляция", "индекс", "запрос", "и", "в", "как"];

/** Deterministic varied bodies: term mix + filler length differ per chunk → distinct bm25. */
function body(book: number, n: number): string {
  const vocab = book % 2 === 0 ? VOCAB_RU : VOCAB_EN;
  const words: string[] = [];
  for (let i = 0; i <= (book * 7 + n * 3) % 11; i++) words.push(vocab[(book + n * i) % vocab.length]!);
  words.push(...Array.from({ length: 3 + ((n * 5 + book) % 9) }, (_, i) => `filler${i}`));
  return words.join(" ");
}

/** Group-insensitive view: ties (equal score) may come back in any order on either plan. */
function canon(rows: { id: number; score: number }[]): string[] {
  return [...rows].sort((a, b) => a.score - b.score || a.id - b.id).map((r) => `${r.id}:${r.score}`);
}

describe("FTS-first rewrite ≡ legacy JOIN SQL", () => {
  let dir: string;
  let s: SqliteIndexStore;
  let raw: DatabaseSync;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-fts-plan-"));
    s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    for (let book = 1; book <= 6; book++) {
      const chunks: IndexedChunk[] = [];
      let at = 0;
      for (let n = 0; n < 25; n++) {
        const b = body(book, n);
        chunks.push({ body: b, charStart: at, charEnd: at + b.length, vector: vec(book * 31 + n) });
        at += b.length + 1;
      }
      s.replaceBook(LIB, { bookId: book, title: `Book ${book} transaction`, authors: ["A"] }, chunks);
    }
    raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
  });

  afterAll(() => {
    raw.close();
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const queries = [
    "transaction isolation lock",
    "query planner",
    "commit",
    "транзакция и блокировка в индекс",
    "как запрос",
    "transaction",
    "nomatchtoken",
  ];

  for (const q of queries) {
    for (const k of [3, 10, 50]) {
      it(`identical ranking for "${q}" k=${k}`, () => {
        const stemmed = stemText(q);
        for (let book = 1; book <= 6; book++) {
          const legacy = (
            raw.prepare(LEGACY_BOOK_FTS).all(ftsMatch(stemmed), book, k) as Record<string, unknown>[]
          ).map((r) => ({ id: Number(r.chunk_id), score: Number(r.score) }));
          const got = s.searchBookFts(LIB, book, stemmed, k).map((h) => ({ id: h.chunkId, score: h.score }));
          expect(got.map((r) => r.score)).toEqual(legacy.map((r) => r.score)); // rank order of scores
          expect(canon(got)).toEqual(canon(legacy)); // same chunks per score
        }
      });
    }
  }

  for (const q of queries) {
    for (const allow of [[1], [2, 5], [1, 3, 4, 6]]) {
      it(`searchLibraryFts restricted: identical book ranking for "${q}" allow=${allow}`, () => {
        const stemmed = stemText(q);
        const k = 10;
        const pool = Math.max(k * 20, 200); // mirrors searchLibraryFts
        const rows = raw.prepare(LEGACY_ALLOW_FTS).all(ftsMatch(stemmed), JSON.stringify(allow), pool) as Record<
          string,
          unknown
        >[];
        // Legacy best-chunk-per-book, as searchLibraryFts reduces the pool.
        const seen = new Set<number>();
        const legacy: { bookId: number; score: number }[] = [];
        for (const r of rows) {
          const bookId = Number(r.book_id);
          if (seen.has(bookId)) continue;
          seen.add(bookId);
          legacy.push({ bookId, score: Number(r.score) });
        }
        const got = s
          .searchLibraryFts(LIB, stemmed, k, new Set(allow))
          .map((h) => ({ bookId: h.bookId, score: h.score }));
        expect(got).toEqual(legacy.slice(0, k));
      });
    }
  }

  it("fixture actually exercises ranking (multi-hit books, distinct scores)", () => {
    const hits = s.searchBookFts(LIB, 1, stemText("transaction isolation lock"), 50);
    expect(hits.length).toBeGreaterThan(5);
    expect(new Set(hits.map((h) => h.score)).size).toBeGreaterThan(3);
  });
});
