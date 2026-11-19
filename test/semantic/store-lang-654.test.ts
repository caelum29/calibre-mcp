// #654 store: `books.lang` holds each book's detected language (ADR-0032 item 2) and the index
// records the stem version its stemmed columns were written with (`meta.stem_version`, item 6).

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

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

const chunk = (i: number, body: string): IndexedChunk => ({
  body,
  charStart: i * 100,
  charEnd: i * 100 + 90,
  vector: axis(i),
});

describe("books.lang and meta.stem_version (#654)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  const file = () => path.join(dir, `${LIB}.sqlite`);
  const query = (sql: string) => {
    const db = new DatabaseSync(file(), { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-lang-654-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replaceBook stores each book's language, NULL when none was detected", () => {
    const s = open();
    s.replaceBook(LIB, { bookId: 1, title: "Книга", authors: ["А"], lang: "ru" }, [chunk(0, "книга о потоках")]);
    s.replaceBook(LIB, { bookId: 2, title: "Book", authors: ["B"], lang: "en" }, [chunk(1, "a book on threads")]);
    s.replaceBook(LIB, { bookId: 3, title: "123", authors: ["C"] }, [chunk(2, "123 456")]);
    s.close();
    expect(query("SELECT book_id, lang FROM books ORDER BY book_id").map((r) => [r.book_id, r.lang])).toEqual([
      [1, "ru"],
      [2, "en"],
      [3, null],
    ]);
  });

  it("an in-place metadata refresh keeps the stored language", () => {
    const s = open();
    const meta = { bookId: 1, title: "Книга", authors: ["А"], lang: "ru" };
    s.replaceBook(LIB, meta, [chunk(0, "книга о потоках")]);
    const spans = s.bookChunkSpans(LIB, 1);
    expect(s.refreshBookMeta(LIB, { bookId: 1, title: "Книга 2", authors: ["А"] }, { spans, kinds: ["body"] })).toBe(
      true,
    );
    s.close();
    expect(query("SELECT title, lang FROM books").map((r) => [r.title, r.lang])).toEqual([["Книга 2", "ru"]]);
  });

  it("the migration adds books.lang to an index built before it", () => {
    const s = open();
    s.replaceBook(LIB, { bookId: 1, title: "Book", authors: ["B"], lang: "en" }, [chunk(0, "threads")]);
    s.close();
    const legacy = new DatabaseSync(file());
    legacy.exec("ALTER TABLE books DROP COLUMN lang"); // the shape before #654
    legacy.close();
    const s2 = open();
    s2.chunkAt(LIB, 1, 0); // opening the library runs the migration
    s2.close();
    expect(query("SELECT lang FROM books").map((r) => r.lang)).toEqual([null]);
  });

  it("a new index records the server's stem version, and indexMeta reports it", () => {
    const s = open();
    s.replaceBook(LIB, { bookId: 1, title: "Book", authors: ["B"], lang: "en" }, [chunk(0, "threads")]);
    const reported = s.indexMeta(LIB)?.stemVersion;
    s.close();
    const stored = query("SELECT value FROM meta WHERE key = 'stem_version'").map((r) => r.value);
    expect({ stored, reported }).toEqual({ stored: [stemVersion()], reported: stemVersion() });
  });

  it("an index without a recorded stem version reports none, and opening it does not invent one", () => {
    const s = open();
    s.replaceBook(LIB, { bookId: 1, title: "Book", authors: ["B"] }, [chunk(0, "threads")]);
    s.close();
    const legacy = new DatabaseSync(file());
    legacy.exec("DELETE FROM meta WHERE key = 'stem_version'"); // an index written before #654
    legacy.close();
    const s2 = open();
    s2.chunkAt(LIB, 1, 0);
    const reported = s2.indexMeta(LIB)?.stemVersion;
    s2.close();
    expect({ reported, stored: query("SELECT value FROM meta WHERE key = 'stem_version'") }).toEqual({
      reported: undefined,
      stored: [],
    });
  });
});
