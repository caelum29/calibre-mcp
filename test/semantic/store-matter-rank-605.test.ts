// #605 library scope in the store: in each half a book is represented by its best body chunk;
// only a book with no body chunk among that half's candidates falls back to its best non-body
// chunk. The vector matrix carries each row's kind and refreshes it with the book.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { MatterKind } from "../../src/domain/structure/matter-kind.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Test_Lib";

/** Axis 0 tilted by w towards the last axis: a query on axis 0 ranks larger w higher. */
function tilt(w: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = w;
  v[EMBED_DIM - 1] = 1 - w;
  return l2normalize(v);
}

const ch = (i: number, body: string, w: number, matterKind: MatterKind): IndexedChunk => ({
  body,
  charStart: i * 100,
  charEnd: i * 100 + 90,
  vector: tilt(w),
  matterKind,
});

const book = (s: SqliteIndexStore, bookId: number, chunks: IndexedChunk[]) =>
  s.replaceBook(LIB, { bookId, title: `Book ${bookId}`, authors: [] }, chunks);

function seeded(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  // Book 1: its index page is the closest chunk; its body chunk trails.
  book(s, 1, [ch(0, "kiwi kiwi kiwi index, 12", 0.99, "back_index"), ch(1, "kiwi grows on vines", 0.6, "body")]);
  // Book 2: body only.
  book(s, 2, [ch(0, "kiwi orchards in spring", 0.7, "body")]);
  // Book 3: only non-body chunks (a contents page and a copyright page).
  book(s, 3, [ch(0, "kiwi contents 3", 0.8, "front"), ch(1, "kiwi kiwi all rights reserved", 0.9, "back_other")]);
  return s;
}

const view = (hits: Array<{ bookId: number; charStart: number; matterKind?: MatterKind }>) =>
  hits.map((h) => [h.bookId, h.charStart, h.matterKind]);

describe("library-scope representative chunk (#605)", () => {
  it("vector half: best body chunk per book, else the best non-body chunk; books ranked by it", () => {
    const s = seeded();
    expect(view(s.searchLibrary(LIB, tilt(1), 10))).toEqual([
      [3, 100, "back_other"],
      [2, 0, "body"],
      [1, 100, "body"],
    ]);
    s.close();
  });

  it("vector half: the score is the representative chunk's own cosine", () => {
    const s = seeded();
    const top1 = s.searchLibrary(LIB, tilt(1), 10).find((h) => h.bookId === 1)!;
    expect(top1.score).toBe(s.searchBook(LIB, 1, tilt(1), 2).find((h) => h.charStart === 100)!.score);
    s.close();
  });

  it("keyword half: best body chunk per book among the pool, else the best non-body chunk", () => {
    const s = seeded();
    const hits = s.searchLibraryFts(LIB, "kiwi", 10);
    expect(hits.map((h) => [h.bookId, h.matterKind]).sort()).toEqual([
      [1, "body"],
      [2, "body"],
      [3, "back_other"],
    ]);
    s.close();
  });

  it("keyword half: books are ordered by their representative's bm25", () => {
    const s = seeded();
    const hits = s.searchLibraryFts(LIB, "kiwi", 10);
    const scores = hits.map((h) => h.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    s.close();
  });

  it("a flags-only refresh that relabels a chunk changes the vector representative", () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    book(s, 1, [ch(0, "index page", 0.99, "body"), ch(1, "real prose", 0.6, "body")]);
    expect(view(s.searchLibrary(LIB, tilt(1), 1))).toEqual([[1, 0, "body"]]);
    const spans = s.bookChunkSpans(LIB, 1);
    expect(
      s.refreshBookMeta(LIB, { bookId: 1, title: "Book 1", authors: [] }, { spans, kinds: ["back_index", "body"] }),
    ).toBe(true);
    expect(view(s.searchLibrary(LIB, tilt(1), 1))).toEqual([[1, 100, "body"]]);
    s.close();
  });
});
