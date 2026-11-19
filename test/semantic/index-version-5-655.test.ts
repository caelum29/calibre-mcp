// #655 / ADR-0033: index version 5. A version-4 index (raw-text coordinates) is refused with the
// actionable rebuild message — never served next to cleaned coordinates — and every book's
// cleaned→raw offset map is stored with its chunks.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { INDEX_VERSION, EMBED_DIM, MODEL_ID } from "../../src/semantic/model.js";
import { staleness } from "../../src/semantic/staleness.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

const LIB = "Test_Lib";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-v5-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
const meta = { bookId: 7, title: "T", authors: ["A"] };
const body = "cleaned text";
const chunks = [{ body, charStart: 0, charEnd: body.length }];

describe("index version 5 (#655)", () => {
  it("is version 5", () => {
    expect(INDEX_VERSION).toBe(5);
  });

  it("reports a version-4 index as needing a rebuild", () => {
    expect(staleness({ modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: 4 })).toBe("indexVersion 4 (server: 5)");
  });

  it("refuses to open a version-4 index for search, with the rebuild steer", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks);
    s.close();
    const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
    raw.prepare("UPDATE meta SET value = '4' WHERE key = 'index_version'").run();
    raw.close();

    const b = open();
    expect(() => b.stats(LIB)).toThrow(/INDEX_INCOMPATIBLE.*index_version=4.*uses 5.*rebuild/s);
    expect(() => b.searchBookFts(LIB, 7, "cleaned", 5)).toThrow(/INDEX_INCOMPATIBLE/);
    b.close();
  });
});

describe("per-book offset map storage (#655)", () => {
  const read = () => {
    const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
    try {
      return raw.prepare("SELECT book_id, edits, map FROM text_maps ORDER BY book_id").all();
    } finally {
      raw.close();
    }
  };

  it("stores the encoded map with the book and replaces it on re-index", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks, [], { offsetMap: "m1:4,1,2" });
    s.replaceBook(LIB, { ...meta, bookId: 8 }, chunks, [], { offsetMap: "m1:" });
    s.replaceBook(LIB, meta, chunks, [], { offsetMap: "m1:4,1,2,0,3,0" });
    s.close();
    expect(read()).toEqual([
      { book_id: 7, edits: 2, map: "m1:4,1,2,0,3,0" },
      { book_id: 8, edits: 0, map: "m1:" },
    ]);
  });

  it("drops the map when the book is re-indexed without one or pruned", () => {
    const s = open();
    s.replaceBook(LIB, meta, chunks, [], { offsetMap: "m1:4,1,2" });
    s.replaceBook(LIB, { ...meta, bookId: 8 }, chunks, [], { offsetMap: "m1:1,1,0" });
    s.replaceBook(LIB, meta, chunks);
    s.deleteBooks(LIB, [8]);
    s.close();
    expect(read()).toEqual([]);
  });
});
