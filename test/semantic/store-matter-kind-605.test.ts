// #605 store: an additive `chunks.matter_kind` column, written by replaceBook, and every hit
// carries its kind. The front_matter dual-write ended with #693.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
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

const chunk = (i: number, body: string, extra: Partial<IndexedChunk> = {}): IndexedChunk => ({
  body,
  charStart: i * 100,
  charEnd: i * 100 + 90,
  vector: axis(i),
  ...extra,
});

describe("chunks.matter_kind (#605)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  const file = () => path.join(dir, `${LIB}.sqlite`);
  const rows = () => {
    const db = new DatabaseSync(file(), { readOnly: true });
    try {
      return db
        .prepare("SELECT matter_kind FROM chunks ORDER BY id")
        .all()
        .map((r) => String(r.matter_kind));
    } finally {
      db.close();
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-matter-605-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("the migration adds matter_kind to a legacy index, every row as body", () => {
    const s = open();
    s.replaceBook(LIB, meta, [chunk(0, "contents page", { matterKind: "front" }), chunk(1, "first chapter")]);
    s.close();
    const legacy = new DatabaseSync(file());
    legacy.exec("ALTER TABLE chunks DROP COLUMN matter_kind"); // the shape before #605
    legacy.close();
    const s2 = open();
    s2.chunkAt(LIB, 1, 0); // opening the library runs the migration
    s2.close();
    expect(rows()).toEqual(["body", "body"]);
  });

  it("replaceBook writes each kind", () => {
    const s = open();
    s.replaceBook(LIB, meta, [
      chunk(0, "contents", { matterKind: "front" }),
      chunk(1, "chapter", { matterKind: "body" }),
      chunk(2, "index", { matterKind: "back_index" }),
      chunk(3, "references", { matterKind: "back_biblio" }),
      chunk(4, "copyright", { matterKind: "back_other" }),
    ]);
    s.close();
    expect(rows()).toEqual(["front", "body", "back_index", "back_biblio", "back_other"]);
  });

  it("a chunk without matterKind is stored as body", () => {
    const s = open();
    s.replaceBook(LIB, meta, [chunk(0, "contents"), chunk(1, "chapter", { matterKind: "front" })]);
    s.close();
    expect(rows()).toEqual(["body", "front"]);
  });
});

describe("hits carry their matter kind (#605)", () => {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  s.replaceBook(LIB, meta, [
    chunk(0, "zebra contents", { matterKind: "front" }),
    chunk(1, "zebra chapter prose", { matterKind: "body" }),
    chunk(2, "zebra index, 12", { matterKind: "back_index" }),
  ]);

  it("book scope, both halves, and chunkAt", () => {
    expect(s.searchBook(LIB, 1, axis(2), 1).map((h) => [h.charStart, h.matterKind])).toEqual([[200, "back_index"]]);
    expect(
      s
        .searchBookFts(LIB, 1, "zebra", 3)
        .map((h) => [h.charStart, h.matterKind])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [0, "front"],
      [100, "body"],
      [200, "back_index"],
    ]);
    expect([s.chunkAt(LIB, 1, 10)?.matterKind, s.chunkAt(LIB, 1, 210)?.matterKind]).toEqual(["front", "back_index"]);
  });

  it("library scope, both halves", () => {
    expect(s.searchLibrary(LIB, axis(1), 1).map((h) => h.matterKind)).toEqual(["body"]);
    expect(s.searchLibraryFts(LIB, "prose", 1).map((h) => h.matterKind)).toEqual(["body"]);
  });
});
