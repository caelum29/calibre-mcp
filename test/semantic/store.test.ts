import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { stemText } from "../../src/semantic/stem.js";
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

  it("library hits carry the FULL chunk body while the snippet stays display-truncated", () => {
    const s = store();
    const long = "x".repeat(400); // longer than SNIPPET_CHARS (320)
    s.replaceBook(LIB, { bookId: 1, title: "Long", authors: [] }, [chunk(long, 0)]);
    const [vec] = s.searchLibrary(LIB, axis(0), 5);
    expect(vec!.body).toHaveLength(400); // rerankers need the whole passage
    expect(vec!.snippet).toHaveLength(320);
    const [kw] = s.searchLibraryFts(LIB, "x".repeat(400), 5);
    expect(kw!.body).toHaveLength(400);
    expect(kw!.snippet).toHaveLength(320);
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

  describe("book_meta FTS column (title/authors visible to the keyword half)", () => {
    it("library scope: a query matching only the TITLE surfaces the book's chunks", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Distributed Consensus", authors: ["Leslie"] }, [
        chunk("nodes exchange votes until a quorum agrees", 0),
      ]);
      // "consensus" never occurs in the body — only the title carries it.
      const hits = s.searchLibraryFts(LIB, stemText("consensus"), 5);
      expect(hits.map((h) => h.bookId)).toEqual([1]);
      s.close();
    });

    it("book scope: a title-only query returns the book's passages", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Distributed Consensus", authors: [] }, [
        chunk("nodes exchange votes until a quorum agrees", 0),
      ]);
      const hits = s.searchBookFts(LIB, 1, stemText("consensus"), 5);
      expect(hits[0]!.body).toContain("quorum");
      s.close();
    });

    it("matches by AUTHOR name too", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Refactoring", authors: ["Martin Fowler"] }, [
        chunk("extract method and rename variable", 0),
      ]);
      expect(s.searchLibraryFts(LIB, stemText("fowler"), 5).map((h) => h.bookId)).toEqual([1]);
      s.close();
    });

    it("title matching stems like the body (RU inflection reaches the title)", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Книги о программировании", authors: [] }, [
        chunk("вводная глава без повторения заголовка", 0),
      ]);
      // Query "книга" and title "Книги" both stem to "книг".
      expect(s.searchLibraryFts(LIB, stemText("книга"), 5).map((h) => h.bookId)).toEqual([1]);
      s.close();
    });

    it("a prose (body) match outranks a title-only match — meta helps, never dominates", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Rust Book", authors: [] }, [
        chunk("ownership and borrowing rules", 0),
      ]);
      s.replaceBook(LIB, { bookId: 2, title: "Ownership Guide", authors: [] }, [
        chunk("unrelated cooking recipes", 1),
      ]);
      const hits = s.searchLibraryFts(LIB, stemText("ownership"), 5);
      expect(hits.map((h) => h.bookId)).toEqual([1, 2]); // body match first, meta-only second
      s.close();
    });

    it("re-indexing under a new title drops the old title from the FTS index", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Old Title Alpha", authors: [] }, [chunk("some text", 0)]);
      expect(s.searchLibraryFts(LIB, stemText("alpha"), 5)).toHaveLength(1);
      s.replaceBook(LIB, { bookId: 1, title: "New Title Beta", authors: [] }, [chunk("some text", 0)]);
      expect(s.searchLibraryFts(LIB, stemText("alpha"), 5)).toHaveLength(0);
      expect(s.searchLibraryFts(LIB, stemText("beta"), 5)).toHaveLength(1);
      s.close();
    });
  });

  it("returns [] for a query with no searchable tokens", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "T", authors: [] }, [chunk("hello", 0)]);
    expect(s.searchBookFts(LIB, 1, "   ", 5)).toEqual([]);
    expect(s.searchLibraryFts(LIB, "", 5)).toEqual([]);
    s.close();
  });

  describe("candidate cache", () => {
    it("reports the cache build through the injected logger (stderr seam, no hidden global)", () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }), logger);
      s.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha", 0)]);
      s.searchLibrary(LIB, axis(0), 5);
      expect(logger.info).toHaveBeenCalledWith(
        "semantic candidate cache built",
        expect.objectContaining({ library: LIB, chunks: 1 }),
      );
      s.close();
    });

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

  describe("meta guard (INDEX_INCOMPATIBLE)", () => {
    // The bake-off (D-012) leans on this: an index built by a DIFFERENT embedding model
    // must be refused with the actionable rebuild message, never silently mixed.
    it("refuses an on-disk index whose meta model_id differs from the active model", async () => {
      const { mkdtempSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const path = await import("node:path");
      const { DatabaseSync } = await import("node:sqlite");
      const dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-store-"));
      try {
        const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir });
        const a = new SqliteIndexStore(cfg);
        a.replaceBook(LIB, { bookId: 1, title: "A", authors: [] }, [chunk("alpha", 0)]);
        a.close();

        // Simulate "built by another model": tamper the persisted meta directly.
        const db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
        db.prepare("UPDATE meta SET value = 'some/other-model' WHERE key = 'model_id'").run();
        db.close();

        const b = new SqliteIndexStore(cfg);
        expect(() => b.stats(LIB)).toThrow(/INDEX_INCOMPATIBLE.*model_id.*rebuild/s);
        b.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
