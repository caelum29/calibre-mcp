// #719: one list of per-book tables (PER_BOOK_TABLES) drives both a book's re-index and its prune,
// so a per-book table added later cannot be cleared in one path and missed in the other.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { PER_BOOK_TABLES } from "../../src/semantic/store/writer.js";

const LIB = "Test_Lib";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-perbook-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
const meta = (bookId: number) => ({ bookId, title: "T", authors: ["A"] });
const vec = () => Float32Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
const chunks = [{ body: "some text", charStart: 0, charEnd: 9, vector: vec() }];
const figures = [{ figIndex: 0, page: 1, caption: "Fig. 1", charOffset: 0, format: "pdf" }];
const full = {
  sections: {
    source: "chapters" as const,
    sections: [{ title: "One", level: 1, charStart: 0, charEnd: 9, parent: null, matterKind: "body" as const }],
  },
  offsetMap: "m1:4,1,2",
  metadata: { text: "T A", blurbChars: 0 },
};

/** Rows of every per-book table for one book, as table -> count. */
function counts(bookId: number): Record<string, number> {
  const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
  try {
    return Object.fromEntries(
      PER_BOOK_TABLES.map((t) => [
        t,
        Number((raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`).get(bookId) as { n: number }).n),
      ]),
    );
  } finally {
    raw.close();
  }
}

describe("per-book tables (#719)", () => {
  it("lists every table that has a book_id column", () => {
    const s = open();
    s.replaceBook(LIB, meta(1), chunks, figures, full);
    s.close();
    const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
    const withBookId = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    )
      .map((r) => r.name)
      .filter((t) =>
        (raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((c) => c.name === "book_id"),
      )
      .sort();
    raw.close();
    expect(withBookId).toEqual([...PER_BOOK_TABLES].sort());
  });

  it("replaceBook without extras clears every per-book table the old index held", () => {
    const s = open();
    s.replaceBook(LIB, meta(1), chunks, figures, full);
    s.replaceBook(LIB, meta(2), chunks, figures, full);
    expect(counts(1)).toEqual({
      embeddings: 1,
      chunks: 1,
      figures: 1,
      books: 1,
      sections: 1,
      text_maps: 1,
      book_metadata: 1,
    });
    s.replaceBook(LIB, meta(1), [], []);
    s.close();
    expect(counts(1)).toEqual({
      embeddings: 0,
      chunks: 0,
      figures: 0,
      books: 1,
      sections: 0,
      text_maps: 0,
      book_metadata: 0,
    });
    expect(counts(2)).toEqual({
      embeddings: 1,
      chunks: 1,
      figures: 1,
      books: 1,
      sections: 1,
      text_maps: 1,
      book_metadata: 1,
    });
  });

  it("deleteBooks clears every per-book table for the pruned book only", () => {
    const s = open();
    s.replaceBook(LIB, meta(1), chunks, figures, full);
    s.replaceBook(LIB, meta(2), chunks, figures, full);
    expect(s.deleteBooks(LIB, [1])).toEqual({ books: 1, chunks: 1, figures: 1 });
    s.close();
    expect(counts(1)).toEqual({
      embeddings: 0,
      chunks: 0,
      figures: 0,
      books: 0,
      sections: 0,
      text_maps: 0,
      book_metadata: 0,
    });
    expect(counts(2)).toEqual({
      embeddings: 1,
      chunks: 1,
      figures: 1,
      books: 1,
      sections: 1,
      text_maps: 1,
      book_metadata: 1,
    });
  });
});
