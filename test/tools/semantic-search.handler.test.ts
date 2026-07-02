import { describe, expect, it } from "vitest";
import { semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
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

/** Query embedder returns axis 0; makes axis-0 passages the top hits. */
const queryEmbedder: Embedder = {
  async embedQuery() {
    return axis(0);
  },
  async embedPassages(texts) {
    return texts.map(() => axis(0));
  },
  async warmup() {},
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
};

function deps(store: SqliteIndexStore, embedder: Embedder = queryEmbedder): ToolDeps {
  const content = {
    resolveLibraryId: async () => LIB,
    search: async () => ({ bookIds: [], total: 0, num: 0, offset: 0, sort: "", libraryId: LIB }),
  };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    embedder,
    index: store,
    log,
  };
}

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
