// TermStats over fts5vocab (#651): per-column document frequency (never collection frequency)
// from a temp-schema vocab table, so it works on a read-only handle; cached until the file changes.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { fts5TermStats } from "../../src/semantic/store/term-stats.js";

// same columns and tokenizer as the index (schema.ts), contentful so rows can be inserted directly
const CHUNK_FTS = `CREATE VIRTUAL TABLE chunk_fts USING fts5(body_stem, body, book_meta,
  tokenize='unicode61 remove_diacritics 2 tokenchars ''-_+#.''')`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// "alpha" twice in row 1 (cnt 3, doc 2 in body_stem); "beta" only raw.
function fileDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "term-stats-"));
  dirs.push(dir);
  const file = path.join(dir, "x.sqlite");
  const db = new DatabaseSync(file);
  db.exec(CHUNK_FTS);
  const ins = db.prepare("INSERT INTO chunk_fts(body_stem, body, book_meta) VALUES (?, ?, ?)");
  ins.run("alpha alpha", "alphas beta", "book one");
  ins.run("alpha", "alphas", "book two");
  ins.run("gamma", "gammas", "book one");
  db.close();
  return file;
}

describe("fts5TermStats (#651)", () => {
  it("returns document frequency per column, not collection frequency", () => {
    const db = new DatabaseSync(fileDb(), { readOnly: true });
    const s = fts5TermStats(db);
    expect(s.totalDocs).toBe(3);
    expect(s.docFreq("alpha", "body_stem")).toBe(2);
    expect(s.docFreq("alpha", "body")).toBe(0);
    expect(s.docFreq("beta", "body")).toBe(1);
    expect(s.docFreq("book", "book_meta")).toBe(3);
    expect(s.docFreq("missing", "body_stem")).toBe(0);
    db.close();
  });

  it("works on a read-only connection without writing to the file", () => {
    const file = fileDb();
    const before = new DatabaseSync(file, { readOnly: true });
    const tablesBefore = before.prepare("SELECT name FROM sqlite_master ORDER BY name").all();
    const s = fts5TermStats(before);
    expect(s.docFreq("gamma", "body_stem")).toBe(1);
    expect(before.prepare("SELECT name FROM sqlite_master ORDER BY name").all()).toEqual(tablesBefore);
    before.close();
  });

  it("caches lookups and refreshes them when the file changes", () => {
    const file = fileDb();
    const ro = new DatabaseSync(file, { readOnly: true });
    const s = fts5TermStats(ro);
    expect(s.docFreq("gamma", "body_stem")).toBe(1);
    const rw = new DatabaseSync(file);
    rw.prepare("INSERT INTO chunk_fts(body_stem, body, book_meta) VALUES ('gamma', 'g', 'b')").run();
    rw.close();
    expect(s.docFreq("gamma", "body_stem")).toBe(2);
    expect(s.totalDocs).toBe(4);
    ro.close();
  });

  it("serves a repeated lookup from the cache", () => {
    const db = new DatabaseSync(fileDb(), { readOnly: true });
    const s = fts5TermStats(db, { maxEntries: 8 });
    s.docFreq("alpha", "body_stem");
    s.docFreq("alpha", "body_stem");
    s.docFreq("alpha", "body");
    expect(s.lookups).toBe(1); // one vocab query fills all three columns of a term
    db.close();
  });
});
