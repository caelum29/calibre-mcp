// Diagnostic counts read through a short-lived read-only handle (#325 review): they never migrate
// or write the file, keep the compatibility guard, and still count a pre-#197 file correctly.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

const LIB = "Programming_Books";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function builtIndex(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "store-ro-"));
  dirs.push(dir);
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  s.replaceBook(LIB, { bookId: 1, title: "Rust", authors: [] }, [{ body: "kw", charStart: 0, charEnd: 2 }]);
  s.close();
  return { dir, file: path.join(dir, `${LIB}.sqlite`) };
}

const columns = (file: string): string[] => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>).map((c) => c.name);
  } finally {
    db.close();
  }
};

describe("SqliteIndexStore diagnostic counts on an unopened file (#325)", () => {
  it("should_count_a_pre_197_file_without_migrating_it", () => {
    const { dir, file } = builtIndex();
    const legacy = new DatabaseSync(file);
    legacy.exec("ALTER TABLE books DROP COLUMN embedded_chunks");
    legacy.close();
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    expect({
      stats: s.stats(LIB),
      missing: s.booksMissingVectors(LIB),
      vectors: s.vectorCount(LIB),
      migrated: columns(file).includes("embedded_chunks"),
    }).toEqual({ stats: { books: 1, chunks: 1, figures: 0 }, missing: 1, vectors: 0, migrated: false });
  });

  it("should_refuse_a_file_without_meta_rows_instead_of_initialising_it", () => {
    const { dir, file } = builtIndex();
    const db = new DatabaseSync(file);
    db.exec("DELETE FROM meta");
    db.close();
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    expect(() => s.stats(LIB)).toThrow(/INDEX_UNREADABLE/);
  });

  it("should_return_zero_counts_without_creating_a_file_when_there_is_no_index", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "store-ro-"));
    dirs.push(dir);
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    expect({ stats: s.stats(LIB), has: s.hasIndex(LIB) }).toEqual({
      stats: { books: 0, chunks: 0, figures: 0 },
      has: false,
    });
  });
});
