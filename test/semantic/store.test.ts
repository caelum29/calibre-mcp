import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, type IndexedFigure, SqliteIndexStore } from "../../src/semantic/store/index.js";
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
    expect(hits.map((h) => h.bookId).sort((a, b) => a - b)).toEqual([1, 2]);
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
    expect(s.stats(LIB)).toEqual({ books: 1, chunks: 1, figures: 0 });
    const hits = s.searchLibrary(LIB, axis(2), 5);
    expect(hits[0]!.title).toBe("V2");
    s.close();
  });

  it("isBookIndexed honors lastModified", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 7, title: "T", authors: [], lastModified: "2026-01-01" }, [chunk("x", 0)]);
    expect(s.isBookIndexed(LIB, 7)).toBe(true);
    expect(s.isBookIndexed(LIB, 7, "2026-01-01")).toBe(true);
    expect(s.isBookIndexed(LIB, 7, "2026-02-02")).toBe(false); // stale → needs re-index
    expect(s.isBookIndexed(LIB, 999)).toBe(false);
    s.close();
  });

  it("isolates libraries by id", () => {
    const s = store();
    s.replaceBook("LibA", { bookId: 1, title: "A", authors: [] }, [chunk("a", 0)]);
    expect(s.stats("LibA")).toEqual({ books: 1, chunks: 1, figures: 0 });
    expect(s.stats("LibB")).toEqual({ books: 0, chunks: 0, figures: 0 });
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
      const hits = s.searchLibraryFts(LIB, "consensus", 5);
      expect(hits.map((h) => h.bookId)).toEqual([1]);
      s.close();
    });

    it("book scope: a title-only query returns the book's passages", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Distributed Consensus", authors: [] }, [
        chunk("nodes exchange votes until a quorum agrees", 0),
      ]);
      const hits = s.searchBookFts(LIB, 1, "consensus", 5);
      expect(hits[0]!.body).toContain("quorum");
      s.close();
    });

    it("matches by AUTHOR name too", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Refactoring", authors: ["Martin Fowler"] }, [
        chunk("extract method and rename variable", 0),
      ]);
      expect(s.searchLibraryFts(LIB, "fowler", 5).map((h) => h.bookId)).toEqual([1]);
      s.close();
    });

    it("title matching stems like the body (RU inflection reaches the title)", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Книги о программировании", authors: [] }, [
        chunk("вводная глава без повторения заголовка", 0),
      ]);
      // Query "книга" and title "Книги" both stem to "книг".
      expect(s.searchLibraryFts(LIB, "книга", 5).map((h) => h.bookId)).toEqual([1]);
      s.close();
    });

    it("a prose (body) match outranks a title-only match — meta helps, never dominates", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Rust Book", authors: [] }, [chunk("ownership and borrowing rules", 0)]);
      s.replaceBook(LIB, { bookId: 2, title: "Ownership Guide", authors: [] }, [chunk("unrelated cooking recipes", 1)]);
      const hits = s.searchLibraryFts(LIB, "ownership", 5);
      expect(hits.map((h) => h.bookId)).toEqual([1, 2]); // body match first, meta-only second
      s.close();
    });

    it("re-indexing under a new title drops the old title from the FTS index", () => {
      const s = store();
      s.replaceBook(LIB, { bookId: 1, title: "Old Title Alpha", authors: [] }, [chunk("some text", 0)]);
      expect(s.searchLibraryFts(LIB, "alpha", 5)).toHaveLength(1);
      s.replaceBook(LIB, { bookId: 1, title: "New Title Beta", authors: [] }, [chunk("some text", 0)]);
      expect(s.searchLibraryFts(LIB, "alpha", 5)).toHaveLength(0);
      expect(s.searchLibraryFts(LIB, "beta", 5)).toHaveLength(1);
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

describe("front matter kind (issue #18)", () => {
  it("round-trips matterKind front through replaceBook → searchBook and searchBookFts", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "T", authors: [] }, [
      { ...chunk("praise for this book", 0), matterKind: "front" },
      { ...chunk("real body definition", 1, 100) },
    ]);
    const vec = s.searchBook(LIB, 1, axis(0), 5);
    expect(vec.find((h) => h.body.startsWith("praise"))!.matterKind).toBe("front");
    expect(vec.find((h) => h.body.startsWith("real"))!.matterKind).toBe("body");
    const kw = s.searchBookFts(LIB, 1, "praise body definition", 5);
    expect(kw.find((h) => h.body.startsWith("praise"))!.matterKind).toBe("front");
    expect(kw.find((h) => h.body.startsWith("real"))!.matterKind).toBe("body");
    s.close();
  });

  it("migrates a pre-flag on-disk index additively (old rows read as body)", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { DatabaseSync } = await import("node:sqlite");
    const dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-migrate-"));
    try {
      const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir });
      const a = new SqliteIndexStore(cfg);
      a.replaceBook(LIB, { bookId: 1, title: "Old", authors: [] }, [chunk("legacy chunk body", 0)]);
      a.close();

      // Simulate an index created before the column existed.
      const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
      raw.exec("ALTER TABLE chunks DROP COLUMN matter_kind");
      raw.close();

      // Reopening migrates in place — no INDEX_INCOMPATIBLE, old rows default to body.
      const b = new SqliteIndexStore(cfg);
      const hits = b.searchBook(LIB, 1, axis(0), 5);
      expect(hits[0]!.body).toBe("legacy chunk body");
      expect(hits[0]!.matterKind).toBe("body");
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("figures (D-018 Phase B / #86)", () => {
  const fig = (
    figIndex: number,
    caption: string,
    axisIdx: number | undefined,
    charOffset: number,
    extra: Record<string, unknown> = {},
  ) => ({
    figIndex,
    page: 1,
    caption,
    charOffset,
    format: "pdf",
    source: "page-render" as const,
    ...(axisIdx !== undefined ? { vector: axis(axisIdx) } : {}),
    ...extra,
  });

  it("round-trips figures and ranks captions by cosine, library-wide and per book", () => {
    const s = store();
    s.replaceBook(
      LIB,
      { bookId: 1, title: "SQL Book", authors: ["A"] },
      [chunk("btree chapter", 2)],
      [fig(0, "A B-tree node layout", 0, 5), fig(1, "The query planner's chosen plan", 1, 40)],
    );
    s.replaceBook(
      LIB,
      { bookId: 2, title: "Bee Book", authors: ["B"] },
      [chunk("hive chapter", 3)],
      [fig(0, "Frames inside a hive body", 1, 9, { source: "raster", width: 100, height: 50 })],
    );

    const lib = s.searchFigures(LIB, axis(0), 5);
    expect(lib[0]!.caption).toBe("A B-tree node layout");
    expect(lib[0]!.bookId).toBe(1);
    expect(lib[0]!.title).toBe("SQL Book");
    expect(lib[0]!.figIndex).toBe(0);
    expect(lib[0]!.source).toBe("page-render");
    expect(lib[0]!.score).toBeGreaterThan(lib[1]!.score);

    // book filter: only book 2's figure comes back, dims/source survive the round-trip
    const book2 = s.searchFigures(LIB, axis(1), 5, 2);
    expect(book2).toHaveLength(1);
    expect(book2[0]!.source).toBe("raster");
    s.close();
  });

  it("keyword FTS over captions matches stemmed words and respects the book filter", () => {
    const s = store();
    s.replaceBook(
      LIB,
      { bookId: 1, title: "SQL", authors: [] },
      [chunk("body", 0)],
      [fig(0, "A B-tree node: sorted keys with child pointers", 0, 0)],
    );
    s.replaceBook(
      LIB,
      { bookId: 2, title: "Bees", authors: [] },
      [chunk("body", 1)],
      [fig(0, "Frames hanging inside the hive", 1, 0)],
    );
    const hits = s.searchFiguresFts(LIB, "child pointers", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.bookId).toBe(1);
    expect(s.searchFiguresFts(LIB, "child pointers", 5, 2)).toHaveLength(0);
    s.close();
  });

  it("links both directions: chunkAt finds the containing chunk, figuresInSpan the reverse", () => {
    const s = store();
    // Two adjacent chunks [0,100) and [100,200); figures at 50 (inside 1st) and 100 (boundary).
    s.replaceBook(
      LIB,
      { bookId: 1, title: "T", authors: [] },
      [
        { charStart: 0, charEnd: 100, body: "first chunk", vector: axis(0) },
        { charStart: 100, charEnd: 200, body: "second chunk", vector: axis(1) },
      ],
      [fig(0, "inside the first chunk", 0, 50), fig(1, "exactly on the boundary", 1, 100)],
    );
    expect(s.chunkAt(LIB, 1, 50)!.body).toBe("first chunk");
    // Chunk-boundary edge case (#85 item 7): the marker's text BEGINS at the boundary, so it
    // belongs to the later chunk — and to exactly one chunk, never both.
    expect(s.chunkAt(LIB, 1, 100)!.body).toBe("second chunk");
    expect(s.chunkAt(LIB, 1, 999)).toBeUndefined();

    expect(s.figuresInSpan(LIB, 1, 0, 100).map((f) => f.figIndex)).toEqual([0]);
    expect(s.figuresInSpan(LIB, 1, 100, 200).map((f) => f.figIndex)).toEqual([1]);
    expect(s.figuresInSpan(LIB, 1, 0, 200).map((f) => f.figIndex)).toEqual([0, 1]);
    s.close();
  });

  it("replaceBook clears a book's old figures (idempotent re-index) and drops the cache", () => {
    const s = store();
    const meta = { bookId: 1, title: "T", authors: [] };
    s.replaceBook(LIB, meta, [chunk("body", 0)], [fig(0, "old caption", 0, 0)]);
    s.replaceBook(LIB, meta, [chunk("body", 0)], [fig(0, "new caption", 0, 0)]);
    const hits = s.searchFigures(LIB, axis(0), 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.caption).toBe("new caption");
    expect(s.figureCount(LIB)).toBe(1);
    s.close();
  });

  it("figureCount counts per library and per book; vectorless figures stay FTS-searchable only", () => {
    const s = store();
    s.replaceBook(
      LIB,
      { bookId: 1, title: "T", authors: [] },
      [chunk("body", 0)],
      [
        fig(0, "keyword only caption", undefined, 0), // no vector — keyword-only build
      ],
    );
    expect(s.figureCount(LIB)).toBe(1);
    expect(s.figureCount(LIB, 1)).toBe(1);
    expect(s.figureCount(LIB, 2)).toBe(0);
    expect(s.searchFigures(LIB, axis(0), 5)).toHaveLength(0); // no vectors to rank
    expect(s.searchFiguresFts(LIB, "keyword caption", 5)).toHaveLength(1);
    s.close();
  });
});

describe("SqliteIndexStore — atomic per-book writes + vector freshness (#197)", () => {
  const kw = (body: string, start = 0): IndexedChunk => ({ body, charStart: start, charEnd: start + body.length });

  it("a mid-write failure rolls back, leaving the book's previous rows intact", () => {
    const s = store();
    const meta = { bookId: 1, title: "Old", authors: ["A"], lastModified: "v1" };
    s.replaceBook(LIB, meta, [chunk("old passage", 0)]);
    // A NULL caption violates figures.caption NOT NULL — AFTER the book/chunk/embedding rows
    // of the new version were already inserted in the same transaction.
    const badFigure = { figIndex: 0, page: 1, caption: null, charOffset: 0, format: "pdf" } as unknown as IndexedFigure;
    expect(() =>
      s.replaceBook(LIB, { ...meta, title: "New", lastModified: "v2" }, [chunk("new passage", 1)], [badFigure]),
    ).toThrow();
    expect(s.searchLibrary(LIB, axis(0), 5).map((h) => [h.title, h.body])).toEqual([["Old", "old passage"]]);
  });

  it("a rolled-back write leaves the old version fresh at its old lastModified", () => {
    const s = store();
    const meta = { bookId: 1, title: "Old", authors: [], lastModified: "v1" };
    s.replaceBook(LIB, meta, [chunk("old", 0)]);
    const badFigure = { figIndex: 0, page: 1, caption: null, charOffset: 0, format: "pdf" } as unknown as IndexedFigure;
    expect(() => s.replaceBook(LIB, { ...meta, lastModified: "v2" }, [chunk("new", 1)], [badFigure])).toThrow();
    expect(s.isBookIndexed(LIB, 1, "v1", { requireVectors: true })).toBe(true);
  });

  it("a keyword-only entry is not fresh for a semantic build", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "T", authors: [], lastModified: "v1" }, [kw("a"), kw("b", 1)]);
    expect(s.isBookIndexed(LIB, 1, "v1", { requireVectors: true })).toBe(false);
  });

  it("a keyword-only entry stays fresh for a keyword-only build", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "T", authors: [], lastModified: "v1" }, [kw("a")]);
    expect(s.isBookIndexed(LIB, 1, "v1")).toBe(true);
  });

  it("a partially embedded entry is not fresh for a semantic build", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "T", authors: [], lastModified: "v1" }, [chunk("a", 0), kw("b", 1)]);
    expect(s.isBookIndexed(LIB, 1, "v1", { requireVectors: true })).toBe(false);
  });

  it("a fully embedded entry is fresh for a semantic build", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "T", authors: [], lastModified: "v1" }, [chunk("a", 0), chunk("b", 1, 1)]);
    expect(s.isBookIndexed(LIB, 1, "v1", { requireVectors: true })).toBe(true);
  });

  it("legacy rows without embedded_chunks fall back to counting embeddings", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "calibre-197-"));
    try {
      const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir });
      const writer = new SqliteIndexStore(cfg);
      writer.replaceBook(LIB, { bookId: 1, title: "Emb", authors: [], lastModified: "v1" }, [chunk("a", 0)]);
      writer.replaceBook(LIB, { bookId: 2, title: "Kw", authors: [], lastModified: "v1" }, [kw("b")]);
      writer.close();
      // Simulate rows written before the #197 migration: the marker column is NULL.
      const raw = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
      raw.exec("UPDATE books SET embedded_chunks = NULL");
      raw.close();
      const s = new SqliteIndexStore(cfg);
      expect([
        s.isBookIndexed(LIB, 1, "v1", { requireVectors: true }),
        s.isBookIndexed(LIB, 2, "v1", { requireVectors: true }),
        s.booksMissingVectors(LIB),
      ]).toEqual([true, false, 1]);
      s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("booksMissingVectors counts keyword-only and partial books, not embedded ones", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "Emb", authors: [] }, [chunk("a", 0)]);
    s.replaceBook(LIB, { bookId: 2, title: "Kw", authors: [] }, [kw("b")]);
    s.replaceBook(LIB, { bookId: 3, title: "Half", authors: [] }, [chunk("c", 0), kw("d", 1)]);
    expect(s.booksMissingVectors(LIB)).toBe(2);
  });

  it("preserveEmbedded: a keyword-only write never replaces an embedded book", () => {
    const s = store();
    const meta = { bookId: 1, title: "T", authors: [], lastModified: "v1" };
    s.replaceBook(LIB, meta, [chunk("embedded", 0)]);
    const outcome = s.replaceBook(LIB, { ...meta, lastModified: "v2" }, [kw("keyword")], [], {
      preserveEmbedded: true,
    });
    expect([outcome, s.vectorCount(LIB), s.isBookIndexed(LIB, 1, "v1")]).toEqual(["preserved", 1, true]);
  });

  it("preserveEmbedded still writes a book that has no embeddings yet", () => {
    const s = store();
    const outcome = s.replaceBook(LIB, { bookId: 1, title: "T", authors: [] }, [kw("x")], [], {
      preserveEmbedded: true,
    });
    expect([outcome, s.stats(LIB).chunks]).toEqual(["written", 1]);
  });

  it("a keyword-only writer on another connection cannot downgrade an embedded book (shared file)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "calibre-197-"));
    try {
      const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir });
      const semantic = new SqliteIndexStore(cfg);
      const keywordOnly = new SqliteIndexStore(cfg); // a second server process on the same db
      const meta = { bookId: 1, title: "T", authors: [], lastModified: "v1" };
      semantic.replaceBook(LIB, meta, [chunk("embedded", 0)]);
      const outcome = keywordOnly.replaceBook(LIB, meta, [kw("kw")], [], { preserveEmbedded: true });
      expect([outcome, semantic.isBookIndexed(LIB, 1, "v1", { requireVectors: true })]).toEqual(["preserved", true]);
      semantic.close();
      keywordOnly.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #634: the keyword half reaches identifier tokens (c++, c#, node.js) kept whole in the raw
// body column, mid-sentence and sentence-final ("… in C++."), and still stems plain words.
describe("identifier-like query tokens reach the raw body column (#634)", () => {
  const FILLER = ["gardening and soil", "baking bread at home", "a short history of sailing"];

  /** Books 1–3: mid-sentence identifier, sentence-final identifier, look-alike only; 4–6 filler. */
  function seed(mid: string, final: string, lookalike: string): SqliteIndexStore {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "One", authors: [] }, [chunk(mid, 0)]);
    s.replaceBook(LIB, { bookId: 2, title: "Two", authors: [] }, [chunk(final, 1)]);
    s.replaceBook(LIB, { bookId: 3, title: "Three", authors: [] }, [chunk(lookalike, 2)]);
    FILLER.forEach((text, i) =>
      s.replaceBook(LIB, { bookId: 4 + i, title: "Filler", authors: [] }, [chunk(text, 3 + i)]),
    );
    return s;
  }

  it.each([
    ["c++", "templates in C++ are compiled eagerly", "the engine is written in C++.", "the letter c"],
    ["c#", "async methods in C# return tasks", "the service is written in C#.", "the letter c"],
    ["node.js", "streams in Node.js are event emitters", "the server runs on Node.js.", "a node in js"],
  ])("ranks both %s chunks above the look-alike chunk", (query, mid, final, lookalike) => {
    const s = seed(mid, final, lookalike);
    const ids = s.searchLibraryFts(LIB, query, 10).map((h) => h.bookId);
    expect([ids.slice(0, 2).sort((a, b) => a - b), ids[2]]).toEqual([[1, 2], 3]);
    s.close();
  });

  it("book scope ranks the identifier passages above the look-alike passage", () => {
    const s = store();
    s.replaceBook(LIB, { bookId: 1, title: "One", authors: [] }, [
      chunk("the letter c", 0, 0),
      chunk("templates in C++ are compiled eagerly", 1, 100),
      chunk("the engine is written in C++.", 2, 200),
      ...FILLER.map((text, i) => chunk(text, 3 + i, 300 + i * 100)),
    ]);
    const starts = s.searchBookFts(LIB, 1, "c++", 10).map((h) => h.charStart);
    expect([starts.slice(0, 2).sort((a, b) => a - b), starts[2]]).toEqual([[100, 200], 0]);
    s.close();
  });

  it("still matches a plain word by its stem (templates → template)", () => {
    const s = seed("one template here", "nothing relevant", "nothing at all");
    expect(s.searchLibraryFts(LIB, "templates", 10).map((h) => h.bookId)).toEqual([1]);
    s.close();
  });

  it("figure captions: c++ ranks both identifier captions above the look-alike caption", () => {
    const s = store();
    const caption = (figIndex: number, text: string) => ({
      figIndex,
      page: 1,
      caption: text,
      charOffset: 0,
      format: "pdf",
      source: "page-render" as const,
    });
    s.replaceBook(
      LIB,
      { bookId: 1, title: "One", authors: [] },
      [chunk("body", 0)],
      [caption(0, "Templates in C++ code")],
    );
    s.replaceBook(
      LIB,
      { bookId: 2, title: "Two", authors: [] },
      [chunk("body", 1)],
      [caption(0, "A parser written in C++.")],
    );
    s.replaceBook(LIB, { bookId: 3, title: "Three", authors: [] }, [chunk("body", 2)], [caption(0, "The letter c")]);
    FILLER.forEach((text, i) =>
      s.replaceBook(LIB, { bookId: 4 + i, title: "Filler", authors: [] }, [chunk("body", 3 + i)], [caption(0, text)]),
    );
    const ids = s.searchFiguresFts(LIB, "c++", 10).map((h) => h.bookId);
    expect([ids.slice(0, 2).sort((a, b) => a - b), ids[2]]).toEqual([[1, 2], 3]);
    s.close();
  });
});
