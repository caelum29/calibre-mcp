// File-backed store across two connections (#325 §Arch, from #322): the bundle `allow` filter,
// refreshBookMeta, deleteBooks and preserveEmbedded, as the two servers that share one index file
// (Desktop + Claude Code, #196) see them. The unit tests run these on ":memory:" with one handle.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { stemText } from "../../src/semantic/stem.js";
import {
  type BookMeta,
  type IndexedChunk,
  type IndexedFigure,
  SqliteIndexStore,
} from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Test_Lib";

/** Unit vector on one axis, so cosine ranking is fully determined by the axis choice. */
function axis(i: number, w = 1): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = w;
  v[EMBED_DIM - 1] = 1 - w; // tilt off-axis by (1-w) so books on one axis still rank in a fixed order
  return l2normalize(v);
}

const meta = (bookId: number, title = `Book ${bookId}`): BookMeta => ({
  bookId,
  title,
  authors: ["Author"],
  lastModified: "v1",
});

function chunks(body: string, vector?: Float32Array): IndexedChunk[] {
  const half = Math.floor(body.length / 2);
  return [
    { body: body.slice(0, half), charStart: 0, charEnd: half, ...(vector ? { vector } : {}) },
    { body: body.slice(half), charStart: half, charEnd: body.length, ...(vector ? { vector } : {}) },
  ];
}

const figure = (figIndex: number, caption: string, vector?: Float32Array): IndexedFigure => ({
  figIndex,
  page: figIndex + 1,
  caption,
  charOffset: 5,
  format: "pdf",
  ...(vector ? { vector } : {}),
});

describe("SqliteIndexStore on a temp file, two connections (#322)", () => {
  let dir: string;
  const open = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  let a: SqliteIndexStore;
  let b: SqliteIndexStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-store-file-"));
    a = open();
    // Books 1–4 share axis 0 with decreasing weight → vector order 1,2,3,4; all share "kernel".
    for (const id of [1, 2, 3, 4]) {
      a.replaceBook(LIB, meta(id), chunks(`kernel scheduling notes for book ${id} only`, axis(0, 1 - id * 0.1)), [
        figure(0, `kernel diagram ${id}`, axis(0, 1 - id * 0.1)),
      ]);
    }
    b = open(); // the second "process": its own connection, opened after the writes
  });

  afterEach(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("allow: a second connection's vector, keyword and figure rankings are the unfiltered ones ∩ allow", () => {
    const allow = new Set([2, 4]);
    const q = axis(0);
    expect(b.searchLibrary(LIB, q, 10).map((h) => h.bookId)).toEqual([1, 2, 3, 4]);
    expect(b.searchLibrary(LIB, q, 10, allow).map((h) => h.bookId)).toEqual([2, 4]);
    const kw = b.searchLibraryFts(LIB, stemText("kernel"), 10).map((h) => h.bookId);
    expect(b.searchLibraryFts(LIB, stemText("kernel"), 10, allow).map((h) => h.bookId)).toEqual(
      kw.filter((id) => allow.has(id)),
    );
    expect(b.searchFigures(LIB, q, 10, undefined, allow).map((h) => h.bookId)).toEqual([2, 4]);
    expect(b.searchFigures(LIB, q, 10, undefined, new Set()).map((h) => h.bookId)).toEqual([]);
  });

  it("refreshBookMeta: the new title is keyword-searchable from the other connection; vectors are kept", () => {
    const spans = a.bookChunkSpans(LIB, 3);
    const vectorsBefore = b.vectorCount(LIB);
    const ok = a.refreshBookMeta(
      LIB,
      { ...meta(3, "Zanzibar Handbook"), lastModified: "v2" },
      {
        frontMatterEnd: spans[0]!.charEnd, // first chunk becomes front matter
        spans,
      },
    );
    expect(ok).toBe(true);
    expect(b.searchLibraryFts(LIB, stemText("zanzibar"), 10).map((h) => h.bookId)).toEqual([3]);
    expect(b.searchLibraryFts(LIB, stemText("zanzibar"), 10)[0]?.title).toBe("Zanzibar Handbook");
    expect(b.isBookIndexed(LIB, 3, "v2")).toBe(true);
    expect(b.vectorCount(LIB)).toBe(vectorsBefore);
    expect(b.chunkAt(LIB, 3, 0)?.frontMatter).toBe(true);
    expect(b.chunkAt(LIB, 3, spans[1]!.charStart)?.frontMatter).toBe(false);
  });

  it("deleteBooks: exact counts, and the rows are gone for a fresh connection too", () => {
    expect(a.deleteBooks(LIB, [2, 4, 99])).toEqual({ books: 2, chunks: 4, figures: 2 });
    const c = open();
    try {
      expect(c.indexedBookIds(LIB).sort()).toEqual([1, 3]);
      expect(c.stats(LIB)).toEqual({ books: 2, chunks: 4, figures: 2 });
      expect(
        c
          .searchLibraryFts(LIB, stemText("kernel"), 10)
          .map((h) => h.bookId)
          .sort(),
      ).toEqual([1, 3]);
      expect(c.figureCount(LIB)).toBe(2);
      expect(c.vectorCount(LIB)).toBe(4);
    } finally {
      c.close();
    }
  });

  it("preserveEmbedded: a keyword-only writer on one connection never downgrades a book the other embedded", () => {
    const out = b.replaceBook(LIB, { ...meta(1, "Downgraded"), lastModified: "v2" }, chunks("plain words"), [], {
      preserveEmbedded: true,
    });
    expect(out).toBe("preserved");
    expect(a.bookVectorCount(LIB, 1)).toBe(2);
    expect(a.isBookIndexed(LIB, 1, "v1")).toBe(true);
    expect(a.searchLibraryFts(LIB, stemText("downgraded"), 10)).toEqual([]);
    // A book with no embeddings yet is written by the same keyword-only call.
    expect(b.replaceBook(LIB, meta(5), chunks("plain words"), [], { preserveEmbedded: true })).toBe("written");
    expect(a.indexedBookIds(LIB).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
