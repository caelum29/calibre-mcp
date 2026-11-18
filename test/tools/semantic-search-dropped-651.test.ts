// #651 debug output: at CALIBRE_MCP_LOG_LEVEL=debug the keyword plan's dropped terms (term +
// reason) reach the model in the header text AND in structuredContent, whenever the call ran a
// text keyword half; nothing at the default level, nothing for a vector-only call.

import { beforeEach, describe, expect, it } from "vitest";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { type SemanticDeps, semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import type { ToolResult } from "../../src/tools/types.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";
import { withLiveHitCheck } from "./fake-live-ids.js";

const LIB = "Programming_Books";
const DEBUG = { CALIBRE_MCP_LOG_LEVEL: "debug" };

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

const embedder: Embedder = {
  async embedQuery() {
    return axis(0);
  },
  async embedPassages(texts) {
    return texts.map(() => axis(0));
  },
  async warmup() {},
  countTokens: (s) => s.length,
};

// "the" in 3 of 4 chunks (0.75 > 0.5)
function store(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  ["the ownership rules", "the borrow checker", "the async runtime", "lock free queues"].forEach((body, i) =>
    s.replaceBook(LIB, { bookId: i + 1, title: `Book ${i + 1}`, authors: ["A"] }, [
      { charStart: 0, charEnd: body.length, body, vector: axis(i) },
    ]),
  );
  return s;
}

function deps(env: NodeJS.ProcessEnv = {}): SemanticDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:", ...env }),
    content: fakeContent({
      virtualLibraries: async () => ({}),
      resolveLibraryId: async () => asLibId(LIB),
      search: withLiveHitCheck(),
    }),
    calibre: fakeCalibre({ calibredb: async () => ({ stdout: "", stderr: "" }) }),
    extractor: fakeExtractor(),
    figures: fakeFigures(),
    embedder,
    index: store(),
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({
  query: "the ownership, the borrow",
  scope: "library" as const,
  mode: "keyword" as const,
  topK: 10,
  ...over,
});

const headText = (r: ToolResult): string => (r.content[0]?.type === "text" ? r.content[0].text : "");

describe("calibre_semantic_search keyword plan debug output (#651)", () => {
  beforeEach(() => invalidateBundleCache());

  it("should_put_the_dropped_terms_into_structured_content_at_debug_level", async () => {
    const r = await semanticSearchTool.handler(args(), deps(DEBUG));
    expect(r.structuredContent?.dropped).toEqual([
      { term: "the", reason: "too-common" },
      { term: "the", reason: "duplicate" },
    ]);
  });

  it("should_mirror_the_dropped_terms_into_the_header_text_at_debug_level", async () => {
    const r = await semanticSearchTool.handler(args(), deps(DEBUG));
    expect(headText(r)).toContain("Keyword plan (debug): dropped the (too-common), the (duplicate)");
  });

  it("should_say_nothing_was_dropped_when_the_plan_keeps_every_term", async () => {
    const r = await semanticSearchTool.handler(args({ query: "ownership borrow" }), deps(DEBUG));
    expect([r.structuredContent?.dropped, headText(r).includes("Keyword plan (debug): nothing dropped")]).toEqual([
      [],
      true,
    ]);
  });

  it("should_report_the_dropped_terms_for_a_hybrid_book_scope_call", async () => {
    const r = await semanticSearchTool.handler(args({ scope: "book", bookId: 1, mode: "hybrid" }), deps(DEBUG));
    expect(r.structuredContent?.dropped).toEqual([
      { term: "the", reason: "too-common" },
      { term: "the", reason: "duplicate" },
    ]);
  });

  it("should_report_no_keyword_plan_for_a_vector_only_call", async () => {
    const r = await semanticSearchTool.handler(args({ mode: "vector" }), deps(DEBUG));
    expect([r.structuredContent?.dropped, headText(r).includes("Keyword plan")]).toEqual([undefined, false]);
  });

  it("should_report_no_keyword_plan_at_the_default_log_level", async () => {
    const r = await semanticSearchTool.handler(args(), deps());
    expect([r.structuredContent?.dropped, headText(r).includes("Keyword plan")]).toEqual([undefined, false]);
  });
});
