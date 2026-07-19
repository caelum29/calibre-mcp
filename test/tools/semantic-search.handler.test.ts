import { describe, expect, it } from "vitest";
import { semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { RERANK_POOL, type Reranker } from "../../src/semantic/reranker.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { l2normalize } from "../../src/semantic/vector.js";
import type { ToolDeps } from "../../src/tools/types.js";

const LIB = "Programming_Books";

/** Unit vector on a chosen axis (for controlling similarity in tests). */
function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

/** Unit vector between axes 0 and 1 whose cosine vs the axis-0 query falls as `i` grows. */
function fading(i: number, n: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = n - i;
  v[1] = i + 1;
  return l2normalize(v);
}

/** Query embedder returns axis 0; makes axis-0 passages the top hits. */
const queryEmbedder: Embedder = {
  async embedQuery() {
    return axis(0);
  },
  async embedPassages(texts) {
    return texts.map(() => axis(0));
  },
  async warmup() {},
  countTokens: (s) => s.length,
};

/** Embedder that throws — proves keyword mode never touches the model. */
const throwingEmbedder: Embedder = {
  async embedQuery() {
    throw new Error("EMBEDDER_UNAVAILABLE");
  },
  async embedPassages() {
    throw new Error("EMBEDDER_UNAVAILABLE");
  },
  async warmup() {},
  countTokens() {
    throw new Error("EMBEDDER_UNAVAILABLE");
  },
};

function deps(
  store: SqliteIndexStore,
  embedder: Embedder = queryEmbedder,
  reranker?: Reranker,
  env: NodeJS.ProcessEnv = {},
): ToolDeps {
  const content = {
    resolveLibraryId: async () => LIB,
    search: async () => ({ bookIds: [], total: 0, num: 0, offset: 0, sort: "", libraryId: LIB }),
  };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:", ...env }),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    embedder,
    ...(reranker ? { reranker } : {}),
    index: store,
    log,
  };
}

/** Fake reranker: scores each passage by the first matching substring key (0 otherwise). */
function scoreByBody(scores: Record<string, number>): Reranker & { calls: number; pools: number[] } {
  return {
    calls: 0,
    pools: [], // pair-count per rerank call, for the pool-cap assertions
    async rerank(_query, passages) {
      this.calls += 1;
      this.pools.push(passages.length);
      return passages.map((p) => {
        for (const [needle, s] of Object.entries(scores)) if (p.includes(needle)) return s;
        return 0;
      });
    },
    async warmup() {},
  };
}

/** Reranker whose model is missing/broken — exercises the degrade path. */
const brokenReranker: Reranker = {
  async rerank() {
    throw new Error("RERANKER_UNAVAILABLE");
  },
  async warmup() {
    throw new Error("RERANKER_UNAVAILABLE");
  },
};

/** Store preloaded with two indexed books (both best-matched by an axis-0 query). */
function preloaded(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  s.replaceBook(LIB, { bookId: 1, title: "Book One", authors: ["A"] }, [
    { charStart: 0, charEnd: 10, body: "ownership rules", vector: axis(0) },
  ]);
  s.replaceBook(LIB, { bookId: 2, title: "Book Two", authors: ["B"] }, [
    { charStart: 5, charEnd: 20, body: "async passage here", vector: axis(1) },
  ]);
  return s;
}

/** Store with two books indexed keyword-only (no vectors) — the model-free build result. */
function keywordOnly(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  s.replaceBook(LIB, { bookId: 1, title: "Book One", authors: ["A"] }, [
    { charStart: 0, charEnd: 15, body: "ownership rules" }, // no vector
  ]);
  s.replaceBook(LIB, { bookId: 2, title: "Book Two", authors: ["B"] }, [
    { charStart: 5, charEnd: 20, body: "async passage here" }, // no vector
  ]);
  return s;
}

const args = (over: Record<string, unknown> = {}) => ({
  query: "ownership",
  scope: "library" as const,
  mode: "hybrid" as const,
  topK: 10,
  ...over,
});

describe("calibre_semantic_search handler", () => {
  it("errors with guidance when no index exists", async () => {
    const empty = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const r = await semanticSearchTool.handler(args(), deps(empty));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("calibre_build_index");
  });

  it("library scope returns ranked resource_links + maxScore", async () => {
    const r = await semanticSearchTool.handler(args(), deps(preloaded()));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ scope: "library" });
    expect(r.structuredContent?.bookIds as number[]).toContain(1);
    expect(r.structuredContent?.maxScore as number).toBeGreaterThan(0.9);
    expect(r.content.some((b) => b.type === "resource_link")).toBe(true);
  });

  it("mirrors library hits into structuredContent.results for structured-only clients", async () => {
    const r = await semanticSearchTool.handler(args(), deps(preloaded()));
    const results = r.structuredContent?.results as Array<Record<string, unknown>>;
    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBe((r.structuredContent?.bookIds as number[]).length);
    const top = results[0];
    expect(top).toMatchObject({ bookId: expect.any(Number), title: expect.any(String) });
    // The fenced snippet is carried so it survives clients that drop text content blocks.
    expect(top.snippet as string).toContain("UNTRUSTED");
  });

  it("book scope requires bookId", async () => {
    const r = await semanticSearchTool.handler(args({ scope: "book" }), deps(preloaded()));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("requires bookId");
  });

  it("book scope returns fenced passages with char location", async () => {
    const r = await semanticSearchTool.handler(args({ scope: "book", bookId: 1 }), deps(preloaded()));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ scope: "book", bookId: 1 });
    const text = (r.content[1] as { text: string }).text;
    expect(text).toContain("PASSAGE");
    expect(text).toContain("ownership rules");
  });

  it("mirrors book passages into structuredContent.passages for structured-only clients", async () => {
    const r = await semanticSearchTool.handler(args({ scope: "book", bookId: 1 }), deps(preloaded()));
    const passages = r.structuredContent?.passages as Array<Record<string, unknown>>;
    expect(passages).toBeInstanceOf(Array);
    expect(passages.length).toBe(r.structuredContent?.count as number);
    const top = passages[0];
    expect(top).toMatchObject({ charStart: expect.any(Number), charEnd: expect.any(Number) });
    // The fenced passage body is carried verbatim from the text block.
    expect(top.body as string).toContain("ownership rules");
  });

  it("errors when the requested book is not indexed", async () => {
    const r = await semanticSearchTool.handler(args({ scope: "book", bookId: 999 }), deps(preloaded()));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("not indexed");
  });

  it("defaults to hybrid mode", async () => {
    const r = await semanticSearchTool.handler(args(), deps(preloaded()));
    expect(r.structuredContent).toMatchObject({ mode: "hybrid" });
  });

  it("keyword mode matches via FTS and needs no embedding model", async () => {
    // Query "async" hits book 2 by keyword; the throwing embedder proves the model is untouched.
    const r = await semanticSearchTool.handler(
      args({ query: "async", mode: "keyword" }),
      deps(preloaded(), throwingEmbedder),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ mode: "keyword" });
    expect(r.structuredContent?.bookIds as number[]).toEqual([2]);
    // Keyword-only results carry no cosine, so no low-confidence signal.
    expect(r.structuredContent?.maxScore).toBeUndefined();
  });

  it("vector mode ranks by cosine only", async () => {
    const r = await semanticSearchTool.handler(args({ mode: "vector" }), deps(preloaded()));
    expect(r.structuredContent).toMatchObject({ mode: "vector" });
    expect((r.structuredContent?.bookIds as number[])[0]).toBe(1);
    expect(r.structuredContent?.maxScore as number).toBeGreaterThan(0.9);
  });

  it("guides toward keyword mode when the model is unavailable in hybrid", async () => {
    const r = await semanticSearchTool.handler(args(), deps(preloaded(), throwingEmbedder));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain('mode:"keyword"');
  });

  it("keyword mode works on a keyword-only (model-free) index", async () => {
    const r = await semanticSearchTool.handler(
      args({ query: "async", mode: "keyword" }),
      deps(keywordOnly(), throwingEmbedder),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.bookIds as number[]).toEqual([2]);
  });

  it("vector mode errors actionably on a keyword-only index", async () => {
    const r = await semanticSearchTool.handler(
      args({ mode: "vector" }),
      deps(keywordOnly(), throwingEmbedder),
    );
    expect(r.isError).toBe(true);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("keyword-only");
    expect(text).toContain("force");
  });

  it("hybrid degrades to keyword (with a note) on a keyword-only index — no model touched", async () => {
    const r = await semanticSearchTool.handler(
      args({ query: "async", mode: "hybrid" }),
      deps(keywordOnly(), throwingEmbedder), // throwing embedder proves the model is never called
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.bookIds as number[]).toEqual([2]);
    expect(r.structuredContent?.note as string).toContain("keyword-only");
    expect((r.content[0] as { text: string }).text).toContain("keyword-only");
  });

  it("flags low confidence when the top score is below the floor", async () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    // Passage on axis 5 → near-orthogonal to the axis-0 query → low cosine.
    s.replaceBook(LIB, { bookId: 3, title: "Weak", authors: [] }, [
      { charStart: 0, charEnd: 4, body: "weak", vector: axis(5) },
    ]);
    const r = await semanticSearchTool.handler(args(), deps(s));
    expect(r.structuredContent).toMatchObject({ lowConfidence: true });
  });
});

describe("calibre_semantic_search rerank stage", () => {
  it("reorders hybrid results by reranker score (cosine top-1 demoted)", async () => {
    // Cosine puts book 1 first (axis-0 match); the reranker judges book 2's passage stronger.
    const reranker = scoreByBody({ "async passage": 0.9, ownership: 0.2 });
    const r = await semanticSearchTool.handler(args(), deps(preloaded(), queryEmbedder, reranker));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.bookIds as number[]).toEqual([2, 1]);
    expect(r.structuredContent).toMatchObject({ reranked: true, maxRerank: 0.9 });
  });

  it("reorders vector-mode results too", async () => {
    const reranker = scoreByBody({ "async passage": 0.9, ownership: 0.2 });
    const r = await semanticSearchTool.handler(
      args({ mode: "vector" }),
      deps(preloaded(), queryEmbedder, reranker),
    );
    expect((r.structuredContent?.bookIds as number[])[0]).toBe(2);
    expect(r.structuredContent).toMatchObject({ reranked: true });
  });

  it("labels results with the reranker score, keeping the raw cosine alongside", async () => {
    const reranker = scoreByBody({ ownership: 0.9, "async passage": 0.1 });
    const r = await semanticSearchTool.handler(args(), deps(preloaded(), queryEmbedder, reranker));
    const link = r.content.find((b) => b.type === "resource_link") as { description?: string };
    expect(link.description).toContain("rerank 0.900");
    expect(link.description).toContain("cosine");
    expect((r.content[0] as { text: string }).text).toContain("[hybrid+rerank]");
  });

  it("reorders book-scope passages by reranker score", async () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    s.replaceBook(LIB, { bookId: 1, title: "Book One", authors: ["A"] }, [
      { charStart: 0, charEnd: 10, body: "ownership rules", vector: axis(0) },
      { charStart: 10, charEnd: 30, body: "borrow checker details", vector: axis(1) },
    ]);
    const reranker = scoreByBody({ "borrow checker": 0.95, ownership: 0.3 });
    const r = await semanticSearchTool.handler(
      args({ scope: "book", bookId: 1 }),
      deps(s, queryEmbedder, reranker),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ reranked: true, maxRerank: 0.95 });
    // The reranker's pick comes first despite its near-zero cosine.
    expect((r.content[1] as { text: string }).text).toContain("borrow checker");
  });

  it("degrades to the fused order with an advisory note when the reranker fails", async () => {
    const r = await semanticSearchTool.handler(args(), deps(preloaded(), queryEmbedder, brokenReranker));
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent?.bookIds as number[])[0]).toBe(1); // fused order intact
    expect(r.structuredContent).toMatchObject({ reranked: false });
    expect(r.structuredContent?.note as string).toContain("Reranker unavailable");
    expect((r.content[0] as { text: string }).text).toContain("Reranker unavailable");
  });

  it("keyword mode never calls the reranker and stays untouched", async () => {
    const reranker = scoreByBody({ ownership: 0.9 });
    const r = await semanticSearchTool.handler(
      args({ query: "async", mode: "keyword" }),
      deps(preloaded(), throwingEmbedder, reranker),
    );
    expect(r.isError).toBeFalsy();
    expect(reranker.calls).toBe(0);
    expect(r.structuredContent?.bookIds as number[]).toEqual([2]);
    expect(r.structuredContent?.reranked).toBeUndefined(); // no semantic claim → no rerank claim
  });

  it("keyword-only index (hybrid degraded to keyword) skips the reranker", async () => {
    const reranker = scoreByBody({ ownership: 0.9 });
    const r = await semanticSearchTool.handler(
      args({ query: "async", mode: "hybrid" }),
      deps(keywordOnly(), throwingEmbedder, reranker),
    );
    expect(r.isError).toBeFalsy();
    expect(reranker.calls).toBe(0);
    expect(r.structuredContent?.note as string).toContain("keyword-only");
  });

  it("flags low confidence when every reranker score is weak, even with a high cosine", async () => {
    // Cosine 1.0 (above the floor) but the cross-encoder scores everything < RERANK_FLOOR.
    const reranker = scoreByBody({ ownership: 0.05, "async passage": 0.02 });
    const r = await semanticSearchTool.handler(args(), deps(preloaded(), queryEmbedder, reranker));
    expect(r.structuredContent).toMatchObject({ reranked: true, lowConfidence: true });
    expect(r.structuredContent?.maxScore as number).toBeGreaterThan(0.9); // cosine signal kept
  });

  it("silently keeps the fused order when no reranker is wired (no note, no claim)", async () => {
    const r = await semanticSearchTool.handler(args(), deps(preloaded()));
    expect(r.structuredContent).toMatchObject({ reranked: false });
    expect(r.structuredContent?.note).toBeUndefined();
  });

  it("caps cross-encoded pairs at RERANK_POOL; the fused tail past it keeps honest cosine labels", async () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const n = RERANK_POOL + 5;
    s.replaceBook(
      LIB,
      { bookId: 1, title: "Big", authors: ["A"] },
      Array.from({ length: n }, (_, i) => ({
        charStart: i * 100,
        charEnd: i * 100 + 50,
        body: `passage number ${i} text`,
        vector: fading(i, n), // cosine vs the axis-0 query falls with i → fused order = 0..n-1
      })),
    );
    // The LAST in-pool candidate (fused rank 30) wins the rerank; everything else ties at 0.
    const reranker = scoreByBody({ [`passage number ${RERANK_POOL - 1} `]: 0.9 });
    const r = await semanticSearchTool.handler(
      args({ scope: "book", bookId: 1, mode: "vector", topK: 50 }),
      deps(s, queryEmbedder, reranker),
    );
    expect(r.isError).toBeFalsy();
    expect(reranker.pools).toEqual([RERANK_POOL]); // exactly 30 pairs cross-encoded, not 35
    expect(r.structuredContent).toMatchObject({ count: n, reranked: true, maxRerank: 0.9 });
    const texts = r.content.slice(1).map((b) => (b as { text: string }).text);
    // Reranked head first: the rank-30 fused candidate is promoted to the top with its score…
    expect(texts[0]).toContain(`passage number ${RERANK_POOL - 1} `);
    expect(texts[0]).toContain("rerank 0.900");
    // …then the 5 past-the-cap candidates follow in fused order, carrying NO rerank score.
    const tail = texts.slice(RERANK_POOL);
    expect(tail).toHaveLength(5);
    tail.forEach((t, i) => {
      expect(t).toContain(`passage number ${RERANK_POOL + i} `);
      expect(t).not.toContain("rerank");
    });
  });

  it("CALIBRE_MCP_RERANK=off skips a wired reranker, keeping the fused order with a note", async () => {
    const reranker = scoreByBody({ "async passage": 0.9, ownership: 0.2 });
    const r = await semanticSearchTool.handler(
      args(),
      deps(preloaded(), queryEmbedder, reranker, { CALIBRE_MCP_RERANK: "off" }),
    );
    expect(r.isError).toBeFalsy();
    expect(reranker.calls).toBe(0);
    expect(r.structuredContent?.bookIds as number[]).toEqual([1, 2]); // fused order intact
    expect(r.structuredContent).toMatchObject({ reranked: false });
    // The note names the env var so a user can find + flip the switch.
    expect(r.structuredContent?.note as string).toContain("CALIBRE_MCP_RERANK");
    expect((r.content[0] as { text: string }).text).toContain("CALIBRE_MCP_RERANK");
  });
});

describe("calibre_semantic_search front-matter demotion (issue #18)", () => {
  /** Book 1: a front-matter chunk that WINS the cosine race + a body chunk that trails. */
  function frontMatterStore(): SqliteIndexStore {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    s.replaceBook(LIB, { bookId: 1, title: "Book One", authors: ["A"] }, [
      { charStart: 0, charEnd: 40, body: "praise page mentioning ownership", frontMatter: true, vector: axis(0) },
      { charStart: 100, charEnd: 160, body: "the real body definition of ownership", vector: fading(1, 4) },
    ]);
    return s;
  }

  it("demotes front-matter passages below body matches (stable partition)", async () => {
    const r = await semanticSearchTool.handler(
      args({ scope: "book", bookId: 1, mode: "vector" }),
      deps(frontMatterStore()),
    );
    expect(r.isError).toBeUndefined();
    const passages = (r.structuredContent as { passages: Array<{ body: string; frontMatter?: boolean }> }).passages;
    expect(passages[0]!.body).toContain("real body definition"); // body first despite lower cosine
    expect(passages[1]!.frontMatter).toBe(true);
  });

  it("labels demoted passages and notes the demotion in the header", async () => {
    const r = await semanticSearchTool.handler(
      args({ scope: "book", bookId: 1, mode: "vector" }),
      deps(frontMatterStore()),
    );
    const texts = r.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text);
    expect(texts[0]).toContain("front-matter passage(s) (TOC/praise/foreword) demoted");
    expect(texts.find((t) => t.includes("praise page"))).toContain("[front matter]");
    expect(texts.find((t) => t.includes("real body"))).not.toContain("[front matter]");
  });

  it("applies the demotion in keyword mode too", async () => {
    const r = await semanticSearchTool.handler(
      args({ query: "ownership", scope: "book", bookId: 1, mode: "keyword" }),
      deps(frontMatterStore(), throwingEmbedder),
    );
    expect(r.isError).toBeUndefined();
    const passages = (r.structuredContent as { passages: Array<{ frontMatter?: boolean }> }).passages;
    expect(passages[passages.length - 1]!.frontMatter).toBe(true);
  });

  it("claims no demotion when nothing is front matter", async () => {
    const r = await semanticSearchTool.handler(
      args({ scope: "book", bookId: 1, mode: "vector" }),
      deps(preloaded()),
    );
    const texts = r.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text);
    expect(texts[0]).not.toContain("demoted");
    expect(texts.join("\n")).not.toContain("[front matter]");
  });
});

describe("semantic degradation surfacing (issue #41 / #46)", () => {
  it("hybrid degrade on a keyword-only index carries semanticAvailable:false + a reason", async () => {
    const r = await semanticSearchTool.handler(args(), deps(keywordOnly(), throwingEmbedder));
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.semanticAvailable).toBe(false);
    expect(r.structuredContent?.semanticReason as string).toContain("keyword-only");
  });

  it("explicit keyword mode on a keyword-only index still reports semanticAvailable:false", async () => {
    const r = await semanticSearchTool.handler(
      args({ mode: "keyword" }),
      deps(keywordOnly(), throwingEmbedder),
    );
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.semanticAvailable).toBe(false);
    expect(r.structuredContent?.semanticReason as string).toContain("keyword-only");
  });

  it("a vector-capable index reports semanticAvailable:true with no reason", async () => {
    const r = await semanticSearchTool.handler(args(), deps(preloaded()));
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.semanticAvailable).toBe(true);
    expect(r.structuredContent?.semanticReason).toBeUndefined();
  });

  it("the zero-hit path keeps the degradation fields", async () => {
    const r = await semanticSearchTool.handler(
      args({ query: "zzz-no-such-term" }),
      deps(keywordOnly(), throwingEmbedder),
    );
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.count).toBe(0);
    expect(r.structuredContent?.semanticAvailable).toBe(false);
    expect(r.structuredContent?.semanticReason as string).toContain("keyword-only");
  });

  it("scope=book carries the degradation fields too", async () => {
    const r = await semanticSearchTool.handler(
      args({ scope: "book", bookId: 1 }),
      deps(keywordOnly(), throwingEmbedder),
    );
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.semanticAvailable).toBe(false);
    expect(r.structuredContent?.semanticReason as string).toContain("keyword-only");
  });
});
