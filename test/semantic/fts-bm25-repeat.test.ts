// Pins the FTS5 behaviour the keyword planner (#651) relies on, on a real index file: every
// phrase in an OR-ed MATCH adds its own bm25() term — a repeated phrase counts again, and a
// bigram phrase clause adds on top of its words. Dedupe and phrase boosts are built on this.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { WEIGHTED_BM25 } from "../../src/semantic/store/shared.js";

const LIB = "Programming_Books";
let dir = "";
let db: DatabaseSync;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bm25-repeat-"));
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  const body = (t: string, i: number) => ({ body: t, charStart: i * 100, charEnd: i * 100 + t.length });
  s.replaceBook(LIB, { bookId: 1, title: "Zeta", authors: [] }, [
    body("alpha beta gamma delta", 0),
    body("alpha only here", 1),
    body("beta only here", 2),
    body("nothing relevant at all", 3),
    body("filler words for idf", 4),
  ]);
  s.close();
  db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
});
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// score of the "alpha beta gamma delta" chunk under a MATCH
const scoreOf = (match: string): number => {
  const r = db
    .prepare(
      `SELECT ${WEIGHTED_BM25} AS s FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
       WHERE chunk_fts MATCH ? AND c.body = 'alpha beta gamma delta'`,
    )
    .get(match) as { s: number };
  return r.s;
};

describe("FTS5 bm25 over OR-ed phrases (#651)", () => {
  it("a repeated phrase adds its bm25 term again", () => {
    const once = scoreOf('"alpha" OR "beta"');
    const twice = scoreOf('"alpha" OR "alpha" OR "beta"');
    const alpha = scoreOf('"alpha"');
    expect(alpha).toBeLessThan(0);
    expect(twice).toBeCloseTo(once + alpha, 9);
  });

  it("a bigram phrase clause on the stemmed column adds a term on top of its words", () => {
    const words = scoreOf('"alpha" OR "beta"');
    const bigram = scoreOf('{body_stem} : "alpha beta"');
    expect(bigram).toBeLessThan(0);
    expect(scoreOf('"alpha" OR "beta" OR {body_stem} : "alpha beta"')).toBeCloseTo(words + bigram, 9);
  });
});
