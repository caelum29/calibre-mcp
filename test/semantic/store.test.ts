import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Test_Lib";

/** In-memory store (indexDir=":memory:" special-cases to an in-memory sqlite db). */
function store(): SqliteIndexStore {
  return new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
}

/** Unit vector with a single non-zero axis → orthogonal to any other axis. */
function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

function chunk(body: string, axisIdx: number, start = 0): IndexedChunk {
  return { body, charStart: start, charEnd: start + body.length, vector: axis(axisIdx) };
}

describe("SqliteIndexStore", () => {
  it("round-trips a book and ranks passages by cosine", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "Rust Book", authors: ["Steve"] }, [
      chunk("ownership and borrowing", 0),
      chunk("async runtimes", 5),
    ]);
    // Query aligned with axis 0 → first chunk wins.
    const hits = s.searchBook(LIB, 1, axis(0), 5);
    expect(hits[0]!.body).toBe("ownership and borrowing");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    s.close();
  });

  it("searchLibrary returns the best chunk per book, ranked", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "Book One", authors: ["A"] }, [chunk("alpha", 0)]);
    s.replaceBook(LIB, { bookId: 2, title: "Book Two", authors: ["B"] }, [chunk("beta", 3)]);
    const hits = s.searchLibrary(LIB, axis(3), 10);
    expect(hits[0]!.bookId).toBe(2); // axis-3 query → Book Two ranks first
    expect(hits[0]!.title).toBe("Book Two");
    expect(hits.map((h) => h.bookId).sort()).toEqual([1, 2]);
    s.close();
  });

  it("replaceBook is idempotent (re-index replaces, not appends)", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "V1", authors: [] }, [chunk("a", 0), chunk("b", 1)]);
    s.replaceBook(LIB, { bookId: 1, title: "V2", authors: [] }, [chunk("c", 2)]);
    expect(s.stats(LIB)).toEqual({ books: 1, chunks: 1 });
    const hits = s.searchLibrary(LIB, axis(2), 5);
    expect(hits[0]!.title).toBe("V2");
    s.close();
  });

  it("isBookIndexed honors lastModified", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 7, title: "T", authors: [], lastModified: "2026-01-01" }, [
      chunk("x", 0),
    ]);
    expect(s.isBookIndexed(LIB, 7)).toBe(true);
    expect(s.isBookIndexed(LIB, 7, "2026-01-01")).toBe(true);
    expect(s.isBookIndexed(LIB, 7, "2026-02-02")).toBe(false); // stale → needs re-index
    expect(s.isBookIndexed(LIB, 999)).toBe(false);
    s.close();
  });

  it("isolates libraries by id", () => {
    const s = store();
    s.replaceBook("LibA", { bookId: 1, title: "A", authors: [] }, [chunk("a", 0)]);
    expect(s.stats("LibA")).toEqual({ books: 1, chunks: 1 });
    expect(s.stats("LibB")).toEqual({ books: 0, chunks: 0 });
    s.close();
  });
});
