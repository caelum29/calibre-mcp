// #440 (+ merged #442): ping's per-library index report on REAL node:sqlite files — a library
// locked by another process reads as `busy` fast (not `unreadable` after the full busy timeout),
// a WAL writer mid-transaction changes nothing, and every entry says whether it is the default.

import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { libraryIndexReport, type LibraryIndexDeps } from "../../src/app/library-index.js";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

const MAP = { My_Books: "My Books", Other_Books: "Other Books" };
const open: DatabaseSync[] = [];

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function vec(): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return l2normalize(v);
}

/** An index dir holding a 1-book index for My_Books (built, then closed) and none for Other_Books. */
function indexDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lib-index-440-"));
  const builder = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  builder.replaceBook("My_Books", { bookId: 1, title: "Rust in Action", authors: ["Tim McNamara"] }, [
    { charStart: 0, charEnd: 20, body: "ownership moves value", vector: vec() },
  ]);
  builder.close();
  return dir;
}

function deps(dir: string): LibraryIndexDeps {
  return {
    content: {
      libraryInfo: async () => ({ libraryMap: MAP, defaultLibrary: "My_Books" }),
      search: async (p) => ({ bookIds: [], total: 3, num: 0, offset: 0, sort: "", libraryId: p.library ?? "" }),
    },
    // a fresh store with no open handles — the default (5 s) busy timeout is configured
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir })),
  };
}

/** A second connection on the library's file, as another process would hold it. */
function holder(dir: string): DatabaseSync {
  const db = new DatabaseSync(path.join(dir, "My_Books.sqlite"));
  open.push(db);
  return db;
}

describe("libraryIndexReport on real sqlite files (#440)", () => {
  it("should_mark_the_default_library_and_no_other", async () => {
    expect(await libraryIndexReport(deps(indexDir()))).toEqual([
      { id: "My_Books", name: "My Books", isDefault: true, state: "ok", indexed: 1, total: 3, withoutEmbeddings: 0 },
      { id: "Other_Books", name: "Other Books", isDefault: false, state: "none" },
    ]);
  });

  it("should_report_an_exclusively_locked_index_as_busy_in_under_a_second", async () => {
    const dir = indexDir();
    const lock = holder(dir);
    lock.exec("PRAGMA locking_mode = EXCLUSIVE");
    lock.exec("BEGIN; UPDATE meta SET value = value WHERE key = 'model_id'; COMMIT;");
    const started = Date.now();
    const report = await libraryIndexReport(deps(dir));
    const ms = Date.now() - started;
    expect({ first: report?.[0], fast: ms < 1000 }).toEqual({
      first: { id: "My_Books", name: "My Books", isDefault: true, state: "busy" },
      fast: true,
    });
  });

  it("should_read_through_a_WAL_writer_with_an_open_transaction", async () => {
    const dir = indexDir();
    const writer = holder(dir);
    writer.exec("BEGIN EXCLUSIVE; UPDATE meta SET value = value WHERE key = 'model_id';");
    expect((await libraryIndexReport(deps(dir)))?.[0]).toEqual({
      id: "My_Books",
      name: "My Books",
      isDefault: true,
      state: "ok",
      indexed: 1,
      total: 3,
      withoutEmbeddings: 0,
    });
    writer.exec("ROLLBACK");
  });
});
