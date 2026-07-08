import { describe, expect, it, vi } from "vitest";
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

  it("searchBookFts finds passages by stemmed keyword (EN + RU)", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "Mixed", authors: [] }, [
      chunk("Ownership rules and borrowing", 0, 0),
      chunk("книга про программирование", 1, 40),
    ]);
    // Query stems the same way the body was stemmed: "borrowing" → "borrow".
    const en = s.searchBookFts(LIB, 1, "borrow", 5);
    expect(en[0]!.body).toContain("borrowing");
    // RU inflection: query "книги" and body "книга" both stem to "книг".
    const ru = s.searchBookFts(LIB, 1, "книг", 5);
    expect(ru[0]!.body).toContain("книга");
    s.close();
  });

  it("searchLibraryFts ranks the best chunk per book by bm25", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "Rust", authors: [] }, [chunk("ownership and lifetimes", 0)]);
    s.replaceBook(LIB, { bookId: 2, title: "Async", authors: [] }, [chunk("async await futures", 1)]);
    const hits = s.searchLibraryFts(LIB, "async", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.bookId).toBe(2);
    expect(hits[0]!.score).toBeLessThan(0); // bm25 is negative
    s.close();
  });

  it("keeps FTS in sync when replaceBook re-indexes a book (delete trigger)", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "V1", authors: [] }, [chunk("dijkstra shortest path", 0)]);
    expect(s.searchBookFts(LIB, 1, "dijkstra", 5)).toHaveLength(1);
    // Re-index with different text — the old chunk's FTS row must be gone, not orphaned.
    s.replaceBook(LIB, { bookId: 1, title: "V2", authors: [] }, [chunk("gradient descent", 0)]);
    expect(s.searchBookFts(LIB, 1, "dijkstra", 5)).toHaveLength(0);
    expect(s.searchBookFts(LIB, 1, "gradient", 5)).toHaveLength(1);
    s.close();
  });

  it("returns [] for a query with no searchable tokens", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "T", authors: [] }, [chunk("hello", 0)]);
    expect(s.searchBookFts(LIB, 1, "   ", 5)).toEqual([]);
    expect(s.searchLibraryFts(LIB, "", 5)).toEqual([]);
    s.close();
  });

  describe("candidate cache", () => {
    it("repeated searches load the embedding BLOBs from SQLite only once", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha", 0)]);
      s.replaceBook(LIB, { bookId: 2, title: "B", authors: [] }, [chunk("beta", 1)]);
      const loads = vi.spyOn(s, "loadCandidates"); // the SQL-read seam the cache guards
      s.searchLibrary(LIB, axis(0), 5);
      s.searchLibrary(LIB, axis(1), 5);
      s.searchBook(LIB, 2, axis(1), 5); // book scope shares the library-wide cache
      expect(loads).toHaveBeenCalledTimes(1);
      s.close();
    });

    it("search after replaceBook sees the new vectors (write invalidates the cache)", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "V1", authors: [] }, [chunk("old text", 0)]);
      expect(s.searchLibrary(LIB, axis(0), 5)[0]!.snippet).toBe("old text"); // cache is warm
      s.replaceBook(LIB, { bookId: 1, title: "V2", authors: [] }, [chunk("new text", 3)]);
      const hits = s.searchLibrary(LIB, axis(3), 5);
      expect(hits[0]!.snippet).toBe("new text");
      expect(s.searchLibrary(LIB, axis(0), 5)[0]!.score).toBeCloseTo(0); // old vector is gone
      s.close();
    });

    it("cache invalidation is per library (writes elsewhere keep other caches intact)", () => {
      const s = store();
      s.replaceBook("LibA", { bookId: 1, title: "A", authors: [] }, [chunk("a", 0)]);
      s.searchLibrary("LibA", axis(0), 5); // warm LibA's cache
      const loads = vi.spyOn(s, "loadCandidates");
      s.replaceBook("LibB", { bookId: 1, title: "B", authors: [] }, [chunk("b", 1)]);
      s.searchLibrary("LibA", axis(0), 5);
      expect(loads).not.toHaveBeenCalled();
      s.close();
    });

    it("book-scope results are identical on cold and warm cache", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "One", authors: [] }, [
        chunk("first passage", 0, 0),
        chunk("second passage", 1, 40),
      ]);
      s.replaceBook(LIB, { bookId: 2, title: "Two", authors: [] }, [chunk("other book", 0, 0)]);
      const cold = s.searchBook(LIB, 1, axis(1), 5); // first call builds the cache
      const warm = s.searchBook(LIB, 1, axis(1), 5); // second call is pure memory
      expect(warm).toEqual(cold);
      expect(cold.every((h) => [0, 40].includes(h.charStart))).toBe(true); // never leaks book 2
      s.close();
    });

    it("searchBook returns [] for a book with no vectors without hitting SQLite again", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha", 0)]);
      s.searchLibrary(LIB, axis(0), 5); // warm the cache
      const loads = vi.spyOn(s, "loadCandidates");
      expect(s.searchBook(LIB, 999, axis(0), 5)).toEqual([]);
      expect(loads).not.toHaveBeenCalled();
      s.close();
    });
  });
});
