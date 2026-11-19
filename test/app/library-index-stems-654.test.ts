// #654, option (a): ping's per-library index report carries the count of books with stale
// keyword stems (books.stem_version differs from the server's). Real store, fake Content Server:
// the count stays while only some books are re-stemmed and the field clears once all are.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryIndexReport, type LibraryIndexDeps } from "../../src/app/library-index.js";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "A";

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

const chunk = (i: number): IndexedChunk => ({ body: `chunk ${i}`, charStart: 0, charEnd: 7, vector: axis(i) });
const book = (id: number) => ({ bookId: id, title: `Book ${id}`, authors: ["A"], lang: "en" });

function deps(index: SqliteIndexStore): LibraryIndexDeps {
  return {
    content: {
      libraryInfo: async () => ({ libraryMap: { A: "Alpha" }, defaultLibrary: "A" }),
      search: async () => ({ bookIds: [1, 2], total: 2, num: 2, offset: 0, sort: "", libraryId: LIB }),
    },
    index,
  };
}

describe("stale keyword stems in the index report (#654)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-report-stems-654-"));
    const s = open();
    s.replaceBook(LIB, book(1), [chunk(0)]);
    s.replaceBook(LIB, book(2), [chunk(1)]);
    s.close();
    const db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
    db.exec("UPDATE books SET stem_version = 'en:1|ru:1'"); // written by the pre-uk stemmer set
    db.close();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const staleStems = async (s: SqliteIndexStore) => (await libraryIndexReport(deps(s)))?.[0]?.staleStems;

  it("reports every stale book, keeps reporting while only some are re-stemmed, clears when all are", async () => {
    const s = open();
    const before = await staleStems(s);
    s.replaceBook(LIB, book(1), [chunk(0)]);
    const some = await staleStems(s);
    s.replaceBook(LIB, book(2), [chunk(1)]);
    const all = await staleStems(s);
    s.close();
    expect({ before, some, all }).toEqual({ before: 2, some: 1, all: undefined });
  });

  it("keeps the library ok: stale stems are a warning, never an incompatible index", async () => {
    const s = open();
    const row = (await libraryIndexReport(deps(s)))?.[0];
    s.close();
    expect(row).toMatchObject({ state: "ok", indexed: 2, total: 2, staleStems: 2 });
  });
});
