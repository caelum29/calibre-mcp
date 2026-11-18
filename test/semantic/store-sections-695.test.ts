// #695 store: an additive `sections` table (guarded CREATE, no INDEX_VERSION bump). A book's
// rows are rewritten with its chunks in one transaction, removed with the book, and read back
// as the section path at an offset: every span that holds it, top level first.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { BookSections } from "../../src/domain/structure/sections.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Test_Lib";
const meta = { bookId: 1, title: "Book", authors: ["A"] };

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

const chunks = (n: number, vectors = true): IndexedChunk[] =>
  Array.from({ length: n }, (_, i) => ({
    body: `chunk ${i}`,
    charStart: i * 100,
    charEnd: i * 100 + 100,
    ...(vectors ? { vector: axis(i) } : {}),
  }));

// Contents [0,100), Part I [100,400) > Chapter 1 [100,300) > 1.1 [200,300), Chapter 2 [300,400).
const OUTLINE: BookSections = {
  source: "pdf-outline",
  sections: [
    { title: "Contents", level: 1, charStart: 0, charEnd: 100, parent: null, matterKind: "front" },
    { title: "Part I", level: 1, charStart: 100, charEnd: 400, parent: null, matterKind: "body" },
    { title: "Chapter 1", level: 2, charStart: 100, charEnd: 300, parent: 1, matterKind: "body" },
    { title: "1.1 Setup", level: 3, charStart: 200, charEnd: 300, parent: 2, matterKind: "body" },
    { title: "Chapter 2", level: 2, charStart: 300, charEnd: 400, parent: 1, matterKind: "body" },
  ],
};
const CHAPTERS: BookSections = {
  source: "chapters",
  sections: [{ title: "Only Chapter", level: 1, charStart: 0, charEnd: 400, parent: null, matterKind: "body" }],
};

const titles = (s: SqliteIndexStore, offset: number, bookId = 1) =>
  s.sectionPathAt(LIB, bookId, offset).map((r) => r.title);

describe("sections table (#695)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  const file = () => path.join(dir, `${LIB}.sqlite`);
  const count = (bookId = 1) => {
    const db = new DatabaseSync(file(), { readOnly: true });
    try {
      return Number(
        (db.prepare("SELECT COUNT(*) AS n FROM sections WHERE book_id = ?").get(bookId) as { n: number }).n,
      );
    } finally {
      db.close();
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-sections-695-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replaceBook writes the spans; the path at an offset runs from the top level to the deepest span", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: OUTLINE });
    expect(s.sectionPathAt(LIB, 1, 250)).toEqual([
      expect.objectContaining({ title: "Part I", level: 1, charStart: 100, charEnd: 400, parentId: null }),
      expect.objectContaining({ title: "Chapter 1", level: 2, charStart: 100, charEnd: 300 }),
      expect.objectContaining({
        title: "1.1 Setup",
        level: 3,
        charStart: 200,
        charEnd: 300,
        matterKind: "body",
        source: "pdf-outline",
      }),
    ]);
    s.close();
  });

  it("links each row to its parent row", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: OUTLINE });
    const [part, chapter, leaf] = s.sectionPathAt(LIB, 1, 250);
    expect([chapter!.parentId, leaf!.parentId]).toEqual([part!.id, chapter!.id]);
    s.close();
  });

  it("an offset at a span's end belongs to the next span; front matter rows carry their kind", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: OUTLINE });
    expect([titles(s, 300), titles(s, 99), s.sectionPathAt(LIB, 1, 0)[0]?.matterKind, titles(s, 400)]).toEqual([
      ["Part I", "Chapter 2"],
      ["Contents"],
      "front",
      [],
    ]);
    s.close();
  });

  it("re-indexing a book replaces its rows; other books keep theirs", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: OUTLINE });
    s.replaceBook(LIB, { ...meta, bookId: 2 }, chunks(4), [], { sections: OUTLINE });
    s.replaceBook(LIB, meta, chunks(4), [], { sections: CHAPTERS });
    s.close();
    expect([count(1), count(2)]).toEqual([1, 5]);
  });

  it("re-indexing without spans clears the book's rows", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: OUTLINE });
    s.replaceBook(LIB, meta, chunks(4));
    s.close();
    expect(count()).toBe(0);
  });

  it("a keyword-only write refused for an embedded book keeps its rows", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: OUTLINE });
    const outcome = s.replaceBook(LIB, meta, chunks(4, false), [], { sections: CHAPTERS, preserveEmbedded: true });
    expect([outcome, titles(s, 250)]).toEqual(["preserved", ["Part I", "Chapter 1", "1.1 Setup"]]);
    s.close();
  });

  it("deleteBooks removes the book's rows", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: OUTLINE });
    s.deleteBooks(LIB, [1]);
    s.close();
    expect(count()).toBe(0);
  });

  it("refreshBookMeta with spans rewrites the book's rows in place", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: CHAPTERS });
    const spans = s.bookChunkSpans(LIB, 1);
    const ok = s.refreshBookMeta(LIB, meta, { spans, kinds: spans.map(() => "body"), sections: OUTLINE });
    expect([ok, titles(s, 250)]).toEqual([true, ["Part I", "Chapter 1", "1.1 Setup"]]);
    s.close();
  });

  it("refreshBookMeta against stale spans writes no rows", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4), [], { sections: CHAPTERS });
    const stale = s.bookChunkSpans(LIB, 1).slice(1);
    const ok = s.refreshBookMeta(LIB, meta, { spans: stale, kinds: stale.map(() => "body"), sections: OUTLINE });
    expect([ok, titles(s, 250)]).toEqual([false, ["Only Chapter"]]);
    s.close();
  });

  it("an index created before the table gains it on open", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks(4));
    s.close();
    const legacy = new DatabaseSync(file());
    legacy.exec("DROP TABLE sections"); // the shape before #695
    legacy.close();
    const s2 = open();
    expect(titles(s2, 0)).toEqual([]);
    s2.replaceBook(LIB, meta, chunks(4), [], { sections: OUTLINE });
    expect(titles(s2, 0)).toEqual(["Contents"]);
    s2.close();
  });

  it("a read on a library with no index returns [] and creates no file", () => {
    const s = open();
    expect([titles(s, 0), existsSync(file())]).toEqual([[], false]);
    s.close();
  });
});
