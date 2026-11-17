// Rerank latency seam (#644): an in-process script sets ToolDeps.retrievalOptions (through
// BuildServerOptions.retrievalOptions) and calibre_semantic_search hands them to retrieve(); a
// server without them keeps the shipped rerank pool. Not a tool param, not an env var.

import { describe, expect, it } from "vitest";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { RERANK_POOL, type Reranker } from "../../src/semantic/reranker.js";
import type { RetrievalOptions } from "../../src/semantic/retrieve.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { semanticSearchTool, type SemanticDeps } from "../../src/tools/calibre_semantic_search.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";
import { withLiveHitCheck } from "./fake-live-ids.js";

const LIB = "Programming_Books";

/** Unit vector between axes 0 and 1 whose cosine vs the axis-0 query falls as `i` grows. */
function fading(i: number, n: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = n - i;
  v[1] = i + 1;
  return l2normalize(v);
}

const embedder: Embedder = {
  async embedQuery() {
    return fading(0, 1);
  },
  async embedPassages(texts) {
    return texts.map(() => fading(0, 1));
  },
  async warmup() {},
  countTokens: (s) => s.length,
};

/** Reranker recording the pair count and options of each call. */
function recording() {
  const calls: Array<{ pairs: number; maxTokens?: number }> = [];
  const reranker: Reranker = {
    async rerank(_q, ps, opts) {
      calls.push({ pairs: ps.length, ...(opts ? { maxTokens: opts.maxTokens } : {}) });
      return ps.map(() => 0.5);
    },
    async warmup() {},
  };
  return { reranker, calls };
}

/** One book with 40 passages, so a full pool has more candidates than RERANK_POOL. */
function store(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  const n = 40;
  s.replaceBook(
    LIB,
    { bookId: 1, title: "Big", authors: ["A"] },
    Array.from({ length: n }, (_, i) => ({
      charStart: i * 100,
      charEnd: i * 100 + 50,
      body: `passage number ${i} text`,
      vector: fading(i, n),
    })),
  );
  return s;
}

function deps(reranker: Reranker, retrievalOptions?: RetrievalOptions): SemanticDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: fakeContent({
      virtualLibraries: async () => ({}),
      resolveLibraryId: async () => asLibId(LIB),
      search: withLiveHitCheck(),
    }),
    calibre: fakeCalibre({ calibredb: async () => ({ stdout: "", stderr: "" }) }),
    extractor: fakeExtractor(),
    figures: fakeFigures(),
    embedder,
    reranker,
    index: store(),
    log,
    ...(retrievalOptions ? { retrievalOptions } : {}),
  };
}

const bookArgs = { query: "passage", scope: "book" as const, bookId: 1, mode: "vector" as const, topK: 10 };

describe("calibre_semantic_search passes ToolDeps.retrievalOptions to retrieve() (#644)", () => {
  it("without retrievalOptions the rerank scores RERANK_POOL pairs at the default length", async () => {
    const { reranker, calls } = recording();
    const r = await semanticSearchTool.handler(bookArgs, deps(reranker));
    expect([r.isError ?? false, calls]).toEqual([false, [{ pairs: RERANK_POOL }]]);
  });

  it("rerankPool 12 and rerankMaxTokens 256 reach the cross-encoder", async () => {
    const { reranker, calls } = recording();
    const r = await semanticSearchTool.handler(bookArgs, deps(reranker, { rerankPool: 12, rerankMaxTokens: 256 }));
    expect([r.isError ?? false, calls]).toEqual([false, [{ pairs: 12, maxTokens: 256 }]]);
  });
});
