// #654 store, option (a): each book records the stem version its stemmed columns were written
// with (`books.stem_version`), so the index can count books with stale stems — the count clears
// once every book is re-stemmed and stays while only some are.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { stemVersion } from "../../src/semantic/language/registry.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Test_Lib";
const OLD = "en:1|ru:1";

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

const chunk = (i: number): IndexedChunk => ({ body: `chunk ${i}`, charStart: 0, charEnd: 7, vector: axis(i) });
const book = (id: number) => ({ bookId: id, title: `Book ${id}`, authors: ["A"], lang: "en" });

describe("books.stem_version (#654, option a)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  const file = () => path.join(dir, `${LIB}.sqlite`);
  const exec = (sql: string) => {
    const db = new DatabaseSync(file());
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-stems-654-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replaceBook records the server's stem version on the book", () => {
    const s = open();
    s.replaceBook(LIB, book(1), [chunk(0)]);
    s.close();
    const db = new DatabaseSync(file(), { readOnly: true });
    const rows = db.prepare("SELECT stem_version FROM books").all();
    db.close();
    expect(rows.map((r) => r.stem_version)).toEqual([stemVersion()]);
  });

  it("counts books with another or no stem version, and the count falls as books are re-stemmed", () => {
    const s = open();
    s.replaceBook(LIB, book(1), [chunk(0)]);
    s.replaceBook(LIB, book(2), [chunk(1)]);
    s.replaceBook(LIB, book(3), [chunk(2)]);
    s.close();
    exec(
      `UPDATE books SET stem_version = '${OLD}' WHERE book_id IN (1, 2); UPDATE books SET stem_version = NULL WHERE book_id = 3`,
    );
    const s2 = open();
    const before = s2.booksWithStaleStems(LIB);
    s2.replaceBook(LIB, book(1), [chunk(0)]);
    const some = s2.booksWithStaleStems(LIB);
    s2.replaceBook(LIB, book(2), [chunk(1)]);
    s2.replaceBook(LIB, book(3), [chunk(2)]);
    const all = s2.booksWithStaleStems(LIB);
    s2.close();
    expect({ before, some, all }).toEqual({ before: 3, some: 2, all: 0 });
  });

  it("an in-place metadata refresh does not mark a stale book current: its body stems are unchanged", () => {
    const s = open();
    s.replaceBook(LIB, book(1), [chunk(0)]);
    s.close();
    exec(`UPDATE books SET stem_version = '${OLD}'`);
    const s2 = open();
    const spans = s2.bookChunkSpans(LIB, 1);
    s2.refreshBookMeta(LIB, { bookId: 1, title: "Renamed", authors: ["A"] }, { spans, kinds: ["body"] });
    const stale = s2.booksWithStaleStems(LIB);
    s2.close();
    expect(stale).toBe(1);
  });

  it("an index without the column counts every book stale, read-only", () => {
    const s = open();
    s.replaceBook(LIB, book(1), [chunk(0)]);
    s.replaceBook(LIB, book(2), [chunk(1)]);
    s.close();
    exec("ALTER TABLE books DROP COLUMN stem_version");
    const s2 = open();
    const stale = s2.booksWithStaleStems(LIB); // diagnostic read: a read-only peek, no migration
    s2.close();
    expect(stale).toBe(2);
  });

  it("reports 0 for an absent index", () => {
    const s = open();
    expect(s.booksWithStaleStems(LIB)).toBe(0);
    s.close();
  });
});
