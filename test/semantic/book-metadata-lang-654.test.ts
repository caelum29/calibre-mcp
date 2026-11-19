// #654 × #631: the book's metadata row is stemmed with the book's language pack, like its chunks
// and book_meta, on both the whole-book write and the in-place metadata refresh (ADR-0032 item 3).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type BookMeta, type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
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

// "програмування" holds no і/ї/є/ґ, so only the book's language picks the Ukrainian stemmer for it.
const UK_BOOK: BookMeta = { bookId: 1, title: "Книга", authors: ["Автор"], lang: "uk" };

describe("book_metadata stems in the book's language (#654)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  const stems = (): string[] => {
    const db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
    try {
      const row = db.prepare("SELECT body_stem FROM book_metadata WHERE book_id = 1").get();
      return String(row?.body_stem ?? "").split(/\s+/);
    } finally {
      db.close();
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-metadata-lang-654-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replaceBook stems the metadata row with the book's pack", () => {
    const s = open();
    s.replaceBook(LIB, UK_BOOK, [chunk(0, "текст книги")], [], {
      metadata: { text: "програмування мовою", blurbChars: 0 },
    });
    s.close();
    expect(stems()).toEqual(["програм", "мов"]);
  });

  it("refreshBookMeta stems a re-embedded metadata row with the stored language", () => {
    const s = open();
    s.replaceBook(LIB, UK_BOOK, [chunk(0, "текст книги")]);
    const spans = s.bookChunkSpans(LIB, 1);
    const { lang: _dropped, ...noLang } = UK_BOOK;
    const ok = s.refreshBookMeta(LIB, noLang, {
      spans,
      kinds: spans.map(() => "body"),
      metadata: { text: "програмування мовою", blurbChars: 0 },
    });
    s.close();
    expect([ok, stems()]).toEqual([true, ["програм", "мов"]]);
  });
});
