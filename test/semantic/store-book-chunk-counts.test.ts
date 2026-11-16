// readBookChunkCounts (#361): chunks per book for dev tooling, through a read-only handle that never
// writes the index file.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBookChunkCounts } from "../../src/semantic/store/schema.js";

describe("readBookChunkCounts", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chunk-counts-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("maps book id to books.chunk_count and leaves the file byte-identical", () => {
    const file = join(dir, "L.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE books (book_id INTEGER PRIMARY KEY, chunk_count INTEGER NOT NULL DEFAULT 0)");
    db.exec("INSERT INTO books VALUES (3, 120), (17, 0)");
    db.close();
    const before = readFileSync(file);
    expect(readBookChunkCounts(file)).toEqual(
      new Map([
        [3, 120],
        [17, 0],
      ]),
    );
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("throws on a file without a books table instead of creating one", () => {
    const file = join(dir, "empty.sqlite");
    new DatabaseSync(file).close();
    expect(() => readBookChunkCounts(file)).toThrow(/no such table: books/);
  });
});
