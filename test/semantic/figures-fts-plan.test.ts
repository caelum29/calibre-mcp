// Ranking-equivalence guard for the FTS-first (MATERIALIZED CTE) rewrite of figure-caption
// keyword search (#347, the #155 fix applied to figures): book-scoped and bundle-restricted
// queries must return exactly the figure ids and bm25 scores the legacy JOIN SQL returned.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { stemText } from "../../src/semantic/stem.js";
import { type IndexedFigure, SqliteIndexStore } from "../../src/semantic/store/index.js";

const LIB = "Fig_Plan_Lib";

// Pre-rewrite SQL, kept verbatim (weights 1.0/1.0/0.5 as in store/shared.ts).
const LEGACY_BOOK = `SELECT f.id AS fig_id, bm25(figure_fts, 1.0, 1.0, 0.5) AS score
  FROM figure_fts JOIN figures f ON f.id = figure_fts.rowid
  WHERE figure_fts MATCH ? AND f.book_id = ? ORDER BY score LIMIT ?`;
const LEGACY_ALLOW = `SELECT f.id AS fig_id, bm25(figure_fts, 1.0, 1.0, 0.5) AS score
  FROM figure_fts JOIN figures f ON f.id = figure_fts.rowid
  WHERE figure_fts MATCH ? AND f.book_id IN (SELECT value FROM json_each(?))
  ORDER BY score LIMIT ?`;

// Same quoting as store/shared.ts ftsMatch: quoted tokens OR-ed together.
const ftsMatch = (stemmed: string) =>
  stemmed
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" OR ");

const VOCAB = ["tree", "node", "pointer", "diagram", "граф", "вершина", "схема", "и"];

/** Deterministic varied captions: term mix + length differ per figure → distinct bm25. */
function caption(book: number, n: number): string {
  const words: string[] = [];
  for (let i = 0; i <= (book * 5 + n * 3) % 7; i++) words.push(VOCAB[(book + n * i) % VOCAB.length]!);
  words.push(...Array.from({ length: 1 + ((n * 3 + book) % 5) }, (_, i) => `pad${i}`));
  return words.join(" ");
}

/** Tie-insensitive view: equal scores may come back in either order on either plan. */
const canon = (rows: { id: number; score: number }[]) =>
  [...rows].sort((a, b) => a.score - b.score || a.id - b.id).map((r) => `${r.id}:${r.score}`);

describe("figure FTS-first rewrite ≡ legacy JOIN SQL (#347)", () => {
  let dir: string;
  let s: SqliteIndexStore;
  let raw: DatabaseSync;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-fig-plan-"));
    s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    for (let book = 1; book <= 5; book++) {
      const figures: IndexedFigure[] = Array.from({ length: 12 }, (_, n) => ({
        figIndex: n,
        page: n + 1,
        caption: caption(book, n),
        charOffset: n * 10,
        format: "pdf",
      }));
      s.replaceBook(LIB, { bookId: book, title: `Book ${book}`, authors: ["A"] }, [], figures);
    }
    raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
  });

  afterAll(() => {
    raw.close();
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const queries = ["tree node", "pointer diagram", "граф и вершина", "схема", "nomatchtoken"];
  const rowsOf = (rows: unknown[]) =>
    (rows as Record<string, unknown>[]).map((r) => ({ id: Number(r.fig_id), score: Number(r.score) }));

  for (const q of queries) {
    for (const k of [3, 50]) {
      it(`book scope: identical ranking for "${q}" k=${k}`, () => {
        const stemmed = stemText(q);
        for (let book = 1; book <= 5; book++) {
          const legacy = rowsOf(raw.prepare(LEGACY_BOOK).all(ftsMatch(stemmed), book, k));
          const got = s.searchFiguresFts(LIB, stemmed, k, book).map((h) => ({ id: h.figureId, score: h.score }));
          expect(got.map((r) => r.score)).toEqual(legacy.map((r) => r.score));
          expect(canon(got)).toEqual(canon(legacy));
        }
      });

      for (const allow of [[1], [2, 4], [1, 3, 5]]) {
        it(`allow set: identical ranking for "${q}" k=${k} allow=${allow}`, () => {
          const stemmed = stemText(q);
          const legacy = rowsOf(raw.prepare(LEGACY_ALLOW).all(ftsMatch(stemmed), JSON.stringify(allow), k));
          const got = s
            .searchFiguresFts(LIB, stemmed, k, undefined, new Set(allow))
            .map((h) => ({ id: h.figureId, score: h.score }));
          expect(got.map((r) => r.score)).toEqual(legacy.map((r) => r.score));
          expect(canon(got)).toEqual(canon(legacy));
        });
      }
    }
  }

  it("fixture actually exercises ranking (multi-hit books, distinct scores)", () => {
    const hits = s.searchFiguresFts(LIB, stemText("tree node"), 50, 1);
    expect(hits.length).toBeGreaterThan(4);
    expect(new Set(hits.map((h) => h.score)).size).toBeGreaterThan(2);
  });
});
