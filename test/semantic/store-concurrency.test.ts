// Two server processes (Claude Desktop + Claude Code) share one index file (#196): the store must
// open it in WAL with a busy_timeout, so a concurrent writer makes it wait instead of failing.

import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Test_Lib";

function chunk(body: string): IndexedChunk {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return { body, charStart: 0, charEnd: body.length, vector: l2normalize(v) };
}

describe("SqliteIndexStore across processes (#196)", () => {
  let dir: string;
  let file: string;
  const store = (busyMs: number) =>
    new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir, CALIBRE_MCP_INDEX_BUSY_TIMEOUT_MS: String(busyMs) }));

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-lock-"));
    file = path.join(dir, `${LIB}.sqlite`);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("opens the index in WAL mode with the configured busy_timeout", () => {
    const s = store(1234);
    s.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha")]);
    // journal_mode is persistent in the file, so a fresh connection sees it.
    const raw = new DatabaseSync(file);
    expect(raw.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
    raw.close();
    s.close();
  });

  it("a writer waits out another connection's write lock instead of failing at once", () => {
    const a = store(5000);
    a.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha")]);
    const b = store(300);
    expect(b.hasIndex(LIB)).toBe(true);
    // "Desktop" holds the write lock; "Claude Code" tries to commit a book.
    const holder = new DatabaseSync(file);
    holder.exec("BEGIN IMMEDIATE");
    const t0 = Date.now();
    expect(() => b.replaceBook(LIB, { bookId: 2, title: "B", authors: [] }, [chunk("beta")])).toThrow(/locked|busy/i);
    // Without busy_timeout this fails in ~0 ms; with it the writer waited ~300 ms first.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    holder.exec("ROLLBACK");
    holder.close();
    // Lock released → the same write now goes through.
    b.replaceBook(LIB, { bookId: 2, title: "B", authors: [] }, [chunk("beta")]);
    expect(a.indexedBookIds(LIB).sort()).toEqual([1, 2]);
    a.close();
    b.close();
  });

  it("readers are not blocked by an open write transaction (WAL)", () => {
    const a = store(5000);
    a.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha")]);
    a.close();
    const holder = new DatabaseSync(file);
    holder.exec("BEGIN IMMEDIATE");
    const b = store(0); // no waiting at all: a read must still succeed
    expect(b.indexMeta(LIB)).toMatchObject({ dim: EMBED_DIM });
    expect(b.indexedBookIds(LIB)).toEqual([1]);
    holder.exec("ROLLBACK");
    holder.close();
    b.close();
  });

  it("close() checkpoints the WAL so the .sqlite is self-contained to copy or move", () => {
    const s = store(5000);
    s.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha")]);
    s.close();
    const wal = `${file}-wal`;
    // Last connection closed: SQLite removes the side files, or TRUNCATE left an empty one.
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
  });

  it("keeps the configured :memory: index working (WAL is a no-op there)", () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    s.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha")]);
    expect(s.indexedBookIds(LIB)).toEqual([1]);
    s.close();
  });
});
