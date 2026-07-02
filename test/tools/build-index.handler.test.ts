import { describe, expect, it } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { l2normalize } from "../../src/semantic/vector.js";
import type { ToolDeps } from "../../src/tools/types.js";

const baseBook: Book = {
  id: 1,
  uuid: "u-1",
  title: "Rust in Action",
  authors: ["Tim"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
};

/** Deterministic fake embedder — every passage → a fixed unit vector (axis 0). */
const fakeEmbedder: Embedder = {
  async embedQuery() {
    const v = new Float32Array(EMBED_DIM);
    v[0] = 1;
    return l2normalize(v);
  },
  async embedPassages(texts) {
    return texts.map(() => {
      const v = new Float32Array(EMBED_DIM);
      v[0] = 1;
      return l2normalize(v);
    });
  },
  async warmup() {},
};

/** Embedder that has no model — warmup and embed both throw the coded signal. */
const unavailableEmbedder: Embedder = {
  async embedQuery() {
    throw new Error("EMBEDDER_UNAVAILABLE");
  },
  async embedPassages() {
    throw new Error("EMBEDDER_UNAVAILABLE");
  },
  async warmup() {
    throw new Error("EMBEDDER_UNAVAILABLE");
  },
};

interface FakeOpts {
  book?: Partial<Book>;
  getText?: () => Promise<ExtractedText>;
  store?: SqliteIndexStore;
  embedder?: Embedder;
}

function deps(opts: FakeOpts = {}): ToolDeps {
  const content = {
    getBook: async (): Promise<Book> => ({ ...baseBook, ...opts.book }),
    resolveLibraryId: async () => "Programming_Books",
    search: async () => ({ bookIds: [1], total: 1, num: 1, offset: 0, sort: "", libraryId: "Programming_Books" }),
  };
  const extractor = {
    getText:
      opts.getText ??
      (async (): Promise<ExtractedText> => ({
        text: "Ownership and borrowing. ".repeat(200),
        backend: "pdftotext",
        chars: 5000,
        cached: false,
      })),
  };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: extractor as unknown as ToolDeps["extractor"],
    embedder: opts.embedder ?? fakeEmbedder,
    index: opts.store ?? new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({
  force: false,
  enableFts: false,
  keywordOnly: false,
  ...over,
});

describe("calibre_build_index handler", () => {
  it("requires a selector (bookId, ids, or query)", async () => {
    const r = await buildIndexTool.handler(args(), deps());
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("Specify bookId, ids, or query");
  });

  it("indexes a single book and reports counts", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const r = await buildIndexTool.handler(args({ bookId: 1 }), deps({ store }));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ booksRequested: 1, booksIndexed: 1, booksSkipped: 0 });
    expect(r.structuredContent?.chunks as number).toBeGreaterThan(0);
    expect(store.isBookIndexed("Programming_Books", 1)).toBe(true);
  });

  it("skips an up-to-date book unless force is set", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    await buildIndexTool.handler(args({ bookId: 1 }), deps({ store }));
    const again = await buildIndexTool.handler(args({ bookId: 1 }), deps({ store }));
    expect(again.structuredContent).toMatchObject({ booksIndexed: 0, booksSkipped: 1 });

    const forced = await buildIndexTool.handler(args({ bookId: 1, force: true }), deps({ store }));
    expect(forced.structuredContent).toMatchObject({ booksIndexed: 1, booksSkipped: 0 });
  });

  it("collects a per-book extraction failure without aborting", async () => {
    const r = await buildIndexTool.handler(
      args({ bookId: 1 }),
      deps({
        getText: async () => ({ text: "   ", backend: "pdftotext", chars: 3, cached: false }),
      }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ booksIndexed: 0 });
    expect((r.structuredContent?.failures as string[])[0]).toContain("book 1");
  });

  it("notes that enableFts is not yet implemented", async () => {
    const r = await buildIndexTool.handler(args({ bookId: 1, enableFts: true }), deps());
    expect((r.content[0] as { text: string }).text).toContain("enableFts");
  });

  it("keywordOnly=true builds without the model — chunks are FTS-searchable, no vectors", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    // The unavailable embedder proves keywordOnly never touches the model (warmup/embed would throw).
    const r = await buildIndexTool.handler(
      args({ bookId: 1, keywordOnly: true }),
      deps({ store, embedder: unavailableEmbedder }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, keywordOnly: true });
    expect((r.content[0] as { text: string }).text).toContain("Keyword-only indexed");
    expect(store.isBookIndexed("Programming_Books", 1)).toBe(true);
    expect(store.hasVectors("Programming_Books")).toBe(false);
    // FTS keyword search still finds the indexed text.
    expect(store.searchLibraryFts("Programming_Books", "ownership", 5).length).toBeGreaterThan(0);
  });

  it("auto-degrades to a keyword-only index when the embedding model is unavailable", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const r = await buildIndexTool.handler(
      args({ bookId: 1 }), // keywordOnly not requested — the warmup probe triggers the degrade
      deps({ store, embedder: unavailableEmbedder }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, keywordOnly: true });
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("KEYWORD-ONLY");
    expect(text).toContain("@huggingface/transformers");
    expect(store.hasVectors("Programming_Books")).toBe(false);
  });
});
