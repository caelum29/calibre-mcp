import { describe, expect, it } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import type { Reranker } from "../../src/semantic/reranker.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
import { EMBED_DIM, MAX_TOKENS, PASSAGE_PREFIX } from "../../src/semantic/model.js";
import { l2normalize } from "../../src/semantic/vector.js";
import type { ToolDeps } from "../../src/tools/types.js";

/** Asserts a remediation text names all three install layouts and the mandatory restart step (#47). */
function expectUniversalRemediation(text: string): void {
  expect(text).toContain(".mcpb extension"); // Claude Desktop bundle branch
  expect(text).toContain("--omit=optional"); // npx / global npm branch
  expect(text).toContain("pnpm add @huggingface/transformers"); // dev-checkout branch
  expect(text).toContain("RESTART the MCP server"); // install alone never takes effect in-process
}

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

/** Fake ~4-chars-per-token count (+2 "special tokens") — non-linear in char length. */
const fakeCountTokens = (s: string) => Math.ceil(s.length / 4) + 2;

/** Deterministic fake embedder — every passage → a fixed unit vector (axis 0). */
function makeFakeEmbedder(): Embedder & { embedded: string[] } {
  const embedded: string[] = [];
  return {
    embedded, // captured embedPassages inputs, for budget assertions
    async embedQuery() {
      const v = new Float32Array(EMBED_DIM);
      v[0] = 1;
      return l2normalize(v);
    },
    async embedPassages(texts) {
      embedded.push(...texts);
      return texts.map(() => {
        const v = new Float32Array(EMBED_DIM);
        v[0] = 1;
        return l2normalize(v);
      });
    },
    async warmup() {},
    countTokens: fakeCountTokens,
  };
}

/** Embedder that has no model — every member throws the coded signal. */
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
  countTokens() {
    throw new Error("EMBEDDER_NOT_LOADED");
  },
};

/** Fake reranker that only counts warmups — the build tool never calls rerank(). */
function fakeReranker(failWarmup = false): Reranker & { warmups: number } {
  return {
    warmups: 0,
    async warmup() {
      this.warmups += 1;
      if (failWarmup) throw new Error("download blocked");
    },
    async rerank() {
      throw new Error("rerank must not run during a build");
    },
  };
}

interface FakeOpts {
  book?: Partial<Book>;
  getText?: () => Promise<ExtractedText>;
  store?: SqliteIndexStore;
  embedder?: Embedder;
  reranker?: Reranker;
  env?: NodeJS.ProcessEnv;
  /** Book ids the library currently holds — what a prune reconciles the index against. */
  libraryIds?: number[];
}

function deps(opts: FakeOpts = {}): ToolDeps {
  const ids = opts.libraryIds ?? [1];
  const content = {
    getBook: async (): Promise<Book> => ({ ...baseBook, ...opts.book }),
    resolveLibraryId: async () => "Programming_Books",
    search: async () => ({
      bookIds: ids,
      total: ids.length,
      num: ids.length,
      offset: 0,
      sort: "",
      libraryId: "Programming_Books",
    }),
  };
  const extractor = {
    getText:
      opts.getText ??
      (async (): Promise<ExtractedText> => ({
        text: "Ownership and borrowing. ".repeat(200),
        backend: "pdftotext",
        chars: 5000,
        cached: false,
        markers: [],
      })),
  };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:", ...opts.env }),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: extractor as unknown as ToolDeps["extractor"],
    embedder: opts.embedder ?? makeFakeEmbedder(),
    ...(opts.reranker ? { reranker: opts.reranker } : {}),
    index: opts.store ?? new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({
  force: false,
  enableFts: false,
  keywordOnly: false,
  prune: false,
  ...over,
});

/** Seed an index row for a book that is NOT in the library — an orphan from a removal/merge. */
function seedOrphan(store: SqliteIndexStore, bookId: number): void {
  store.replaceBook(
    "Programming_Books",
    { bookId, title: "Deleted Book", authors: ["Ghost"], lastModified: "2026-01-01" },
    [{ charStart: 0, charEnd: 20, body: "orphaned passage", frontMatter: false }],
  );
}

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
        getText: async () => ({ text: "   ", backend: "pdftotext", chars: 3, cached: false, markers: [] }),
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

  it("budgets chunks in embedder tokens: every embedded passage fits the model window", async () => {
    const embedder = makeFakeEmbedder();
    const r = await buildIndexTool.handler(args({ bookId: 1 }), deps({ embedder }));
    expect(r.isError).toBeFalsy();
    expect(embedder.embedded.length).toBeGreaterThan(0);
    for (const passage of embedder.embedded) {
      // The full text the model sees ("passage: " + "[title › authors]\n" + body) fits MAX_TOKENS.
      expect(fakeCountTokens(PASSAGE_PREFIX + passage)).toBeLessThanOrEqual(MAX_TOKENS);
    }
    // Token budgeting was actually in effect: at ~4 chars/token the budget edge sits far
    // past the 900-CHAR default, which would have capped every body at 900 chars.
    expect(embedder.embedded.some((p) => p.length > 900)).toBe(true);
  });

  it("pre-warms the reranker on an embedding build (download lands at build time)", async () => {
    const reranker = fakeReranker();
    const r = await buildIndexTool.handler(args({ bookId: 1 }), deps({ reranker }));
    expect(r.isError).toBeFalsy();
    expect(reranker.warmups).toBe(1);
  });

  it("keyword-only builds skip the reranker pre-warm (nothing would use the model)", async () => {
    const reranker = fakeReranker();
    const r = await buildIndexTool.handler(args({ bookId: 1, keywordOnly: true }), deps({ reranker }));
    expect(r.isError).toBeFalsy();
    expect(reranker.warmups).toBe(0);
  });

  it("CALIBRE_MCP_RERANK=off skips the reranker pre-warm", async () => {
    const reranker = fakeReranker();
    const r = await buildIndexTool.handler(
      args({ bookId: 1 }),
      deps({ reranker, env: { CALIBRE_MCP_RERANK: "off" } }),
    );
    expect(r.isError).toBeFalsy();
    expect(reranker.warmups).toBe(0);
  });

  it("a failed reranker pre-download never fails the build — it degrades to a note", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const r = await buildIndexTool.handler(
      args({ bookId: 1 }),
      deps({ store, reranker: fakeReranker(true) }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1 });
    expect((r.content[0] as { text: string }).text).toContain("Reranker model could not be pre-downloaded");
    expect(store.isBookIndexed("Programming_Books", 1)).toBe(true); // the book still indexed
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
    // The auto-degrade warning carries the universal 3-branch install + restart remediation (#47).
    expectUniversalRemediation(text);
    expect(store.hasVectors("Programming_Books")).toBe(false);
  });

  it("requested keywordOnly's note carries the universal install + restart remediation (#47)", async () => {
    const r = await buildIndexTool.handler(args({ bookId: 1, keywordOnly: true }), deps());
    expect(r.isError).toBeFalsy();
    expectUniversalRemediation((r.content[0] as { text: string }).text);
  });
});

describe("orphan prune (issue #100)", () => {
  const LIB = "Programming_Books";

  it("deletes index rows for books that are no longer in the library", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    seedOrphan(store, 42);
    const r = await buildIndexTool.handler(args({ bookId: 1, prune: true }), deps({ store, libraryIds: [1] }));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ prunedBooks: 1, prunedChunks: 1 });
    expect(store.isBookIndexed(LIB, 42)).toBe(false);
    expect(store.isBookIndexed(LIB, 1)).toBe(true);
  });

  it("leaves the index alone without prune=true", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    seedOrphan(store, 42);
    const r = await buildIndexTool.handler(args({ bookId: 1 }), deps({ store, libraryIds: [1] }));
    expect(r.structuredContent?.prunedBooks).toBeUndefined();
    expect(store.isBookIndexed(LIB, 42)).toBe(true);
  });

  it("reports the pruned count in the text block, not just structuredContent", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    seedOrphan(store, 42);
    const r = await buildIndexTool.handler(args({ bookId: 1, prune: true }), deps({ store, libraryIds: [1] }));
    expect((r.content[0] as { text: string }).text).toContain("Pruned 1 book(s)");
  });

  it("refuses to prune when the library lists zero books — an empty listing must not wipe the index", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    seedOrphan(store, 42);
    const r = await buildIndexTool.handler(args({ bookId: 1, prune: true }), deps({ store, libraryIds: [] }));
    expect(r.isError).toBeFalsy();
    expect((r.content[0] as { text: string }).text).toContain("Prune skipped");
    expect(store.isBookIndexed(LIB, 42)).toBe(true);
  });

  it("says so when there is nothing stale to prune", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const r = await buildIndexTool.handler(args({ bookId: 1, prune: true }), deps({ store, libraryIds: [1] }));
    expect(r.structuredContent).toMatchObject({ prunedBooks: 0 });
    expect((r.content[0] as { text: string }).text).toContain("no stale books");
  });
});

describe("empty-extraction message (issue #100 nit)", () => {
  it("blames the EPUB, not a scanned PDF, when an EPUB yields no text", async () => {
    const r = await buildIndexTool.handler(
      args({ bookId: 1 }),
      deps({
        book: { formats: ["epub"] },
        getText: async () => ({ text: "   ", backend: "ebook-convert", chars: 3, cached: false, markers: [] }),
      }),
    );
    const failure = (r.structuredContent?.failures as string[])[0]!;
    expect(failure).toContain("EPUB has no extractable text layer");
    expect(failure).not.toContain("PDF");
  });

  it("still diagnoses a scanned PDF for PDFs", async () => {
    const r = await buildIndexTool.handler(
      args({ bookId: 1 }),
      deps({ getText: async () => ({ text: "   ", backend: "pdftotext", chars: 3, cached: false, markers: [] }) }),
    );
    expect((r.structuredContent?.failures as string[])[0]).toContain("scanned/image PDF");
  });
});

describe("semantic degradation surfacing (issue #41 / #46)", () => {
  it("auto-degrade carries semanticAvailable:false + a reason in structuredContent", async () => {
    const r = await buildIndexTool.handler(
      args({ bookId: 1 }),
      deps({ embedder: unavailableEmbedder }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.semanticAvailable).toBe(false);
    expect(r.structuredContent?.semanticReason as string).toContain("unavailable");
  });

  it("auto-degrade leads the text block with the degrade warning, before the count summary", async () => {
    const r = await buildIndexTool.handler(
      args({ bookId: 1 }),
      deps({ embedder: unavailableEmbedder }),
    );
    const text = (r.content[0] as { text: string }).text;
    // The warning must come first — a client skimming line 1 must not read unqualified success.
    expect(text.indexOf("Embedding model unavailable")).toBe(0);
  });

  it("requested keywordOnly carries semanticAvailable:false + a keywordOnly reason", async () => {
    const r = await buildIndexTool.handler(args({ bookId: 1, keywordOnly: true }), deps());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.semanticAvailable).toBe(false);
    expect(r.structuredContent?.semanticReason as string).toContain("keywordOnly");
  });

  it("an embedding build carries semanticAvailable:true and no reason", async () => {
    const r = await buildIndexTool.handler(args({ bookId: 1 }), deps());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.semanticAvailable).toBe(true);
    expect(r.structuredContent?.semanticReason).toBeUndefined();
  });
});

describe("front-matter flagging at build time (issue #18)", () => {
  it("flags majority-front-matter chunks, including one straddling the chapter boundary", async () => {
    // ~1.4k chars of praise/TOC, then two real chapters — boundary sits mid-first-chunk.
    const front =
      "Praise for This Book\n\n" +
      "A wonderful volume about widgets. ".repeat(30) +
      "\nContents\n\nChapter 1: Widgets ..... 9\nChapter 2: Gadgets ..... 40\n\n";
    const body =
      "Chapter 1: Widgets\n\n" +
      "The widget is the unit of composition. ".repeat(60) +
      "\nChapter 2: Gadgets\n\n" +
      "A gadget wraps a widget with behavior. ".repeat(60);
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const d = deps({
      store,
      getText: async () => ({ text: front + body, backend: "pdftotext", chars: front.length + body.length, cached: false, markers: [] }),
    });
    const r = await buildIndexTool.handler(args({ bookId: 1 }), d);
    expect(r.isError).toBeUndefined();

    const hits = store.searchBookFts("Programming_Books", 1, "praise widget gadget", 20);
    const flagged = hits.filter((h) => h.frontMatter);
    const bodyHits = hits.filter((h) => !h.frontMatter);
    // The praise/TOC region is flagged even though its chunk crosses into chapter 1…
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...flagged.map((h) => h.charStart))).toBe(0);
    // …and the real chapters are not.
    expect(bodyHits.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...bodyHits.map((h) => h.charEnd))).toBeGreaterThan(front.length);
  });

  it("flags nothing when the text has no detectable front matter", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const d = deps({ store });
    const r = await buildIndexTool.handler(args({ bookId: 1 }), d);
    expect(r.isError).toBeUndefined();
    const hits = store.searchBookFts("Programming_Books", 1, "ownership", 20);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => !h.frontMatter)).toBe(true);
  });
});

describe("figure caption indexing (D-018 Phase B / #86)", () => {
  const LIB = "Programming_Books";
  /** Extraction whose markers say two figures sit in the (marker-injected) text. */
  const markedGetText = async (): Promise<ExtractedText> => ({
    text: `[image #0: page 3, "Figure 1-1. The ownership tree"]\n` + "Ownership and borrowing. ".repeat(200),
    backend: "pdftotext",
    chars: 5000,
    cached: false,
    markers: [
      { index: 0, charOffset: 0, page: 3, caption: 'Figure 1-1. The ownership tree' },
      { index: 1, charOffset: 120, page: 7, caption: "Figure 2-4. Borrow checker flow" },
    ],
  });
  /** Inventory matching the markers by entry index — the source/dims join input. */
  const inventory = {
    entries: [
      { index: 0, page: 3, captioned: true, source: "raster", width: 640, height: 480, pdfImageNum: 2 },
      { index: 1, page: 7, captioned: true, source: "page-render" },
    ],
    pageCount: 10,
    scanned: false,
    counts: { figures: 2, uncaptioned: 0, pageRender: 1 },
  };
  const figuresService = (fail = false) => ({
    getInventory: async () => {
      if (fail) throw new Error("FIGURES_SCAN_FAILED");
      return { inventory, cached: true };
    },
  });
  const withFigures = (d: ToolDeps, fail = false): ToolDeps =>
    ({ ...d, figures: figuresService(fail) as unknown as ToolDeps["figures"] });

  it("indexes every placed marker as a figure row, joined with inventory source/dims", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const embedder = makeFakeEmbedder();
    const d = withFigures(deps({ store, embedder, getText: markedGetText }));
    const r = await buildIndexTool.handler(args({ bookId: 1 }), d);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.figures).toBe(2);
    expect(store.figureCount(LIB, 1)).toBe(2);

    const hits = store.searchFiguresFts(LIB, "borrow", 5, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.figIndex).toBe(1);
    expect(hits[0]!.page).toBe(7);
    expect(hits[0]!.source).toBe("page-render");
    expect(hits[0]!.charOffset).toBe(120);
    expect(hits[0]!.format).toBe("pdf");
    // captions were embedded with the same "[title › authors]" context prefix as chunks
    expect(embedder.embedded.some((t) => t.includes("[Rust in Action › Tim]") && t.includes("ownership tree"))).toBe(true);
    // caption vectors exist → vector figure search ranks them
    const q = new Float32Array(EMBED_DIM);
    q[0] = 1;
    expect(store.searchFigures(LIB, l2normalize(q), 5, 1)).toHaveLength(2);
  });

  it("keywordOnly build stores captions FTS-searchable, without vectors", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const d = withFigures(deps({ store, getText: markedGetText }));
    const r = await buildIndexTool.handler(args({ bookId: 1, keywordOnly: true }), d);
    expect(r.isError).toBeUndefined();
    expect(store.figureCount(LIB, 1)).toBe(2);
    expect(store.searchFiguresFts(LIB, "ownership tree", 5, 1).length).toBeGreaterThan(0);
    const q = new Float32Array(EMBED_DIM);
    q[0] = 1;
    expect(store.searchFigures(LIB, l2normalize(q), 5, 1)).toHaveLength(0);
  });

  it("an unavailable inventory degrades to captions without source/dims — never fails the book", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const d = withFigures(deps({ store, getText: markedGetText }), true);
    const r = await buildIndexTool.handler(args({ bookId: 1 }), d);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.failures).toEqual([]);
    const hits = store.searchFiguresFts(LIB, "borrow", 5, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.source).toBeUndefined();
  });

  it("a markerless book indexes zero figures and never calls the inventory service", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    // deps() has no figures service at all — a getInventory call would TypeError into a failure
    const r = await buildIndexTool.handler(args({ bookId: 1 }), deps({ store }));
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.failures).toEqual([]);
    expect(store.figureCount(LIB, 1)).toBe(0);
  });
});
