// #590: a 1–2 character query in semantic/hybrid mode is a real query (Go, AI), not an error — it
// runs, and one note line steers to mode:"keyword" or a longer query.

import { describe, expect, it } from "vitest";
import { semanticSearchTool, type SemanticDeps } from "../../src/tools/calibre_semantic_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";
import { withLiveHitCheck } from "./fake-live-ids.js";

const LIB = "Programming_Books";
const SHORT_NOTE = 'mode:"keyword"';

function axis0(): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return l2normalize(v);
}

const embedder: Embedder = {
  embedQuery: async () => axis0(),
  embedPassages: async (texts) => texts.map(() => axis0()),
  async warmup() {},
  countTokens: (s) => s.length,
};

function deps(): SemanticDeps {
  const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  store.replaceBook(LIB, { bookId: 1, title: "Go in Action", authors: ["A"] }, [
    { charStart: 0, charEnd: 20, body: "Go channels and AI", vector: axis0() },
  ]);
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
    index: store,
    log,
  };
}

const run = async (query: string, mode: "hybrid" | "vector" | "keyword") => {
  const r = await semanticSearchTool.handler({ query, scope: "library", mode, topK: 10 }, deps());
  const text = r.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  return { isError: r.isError ?? false, steers: text.includes(SHORT_NOTE) };
};

describe("#590 short semantic query", () => {
  it.each([
    ["Go", "hybrid"],
    [" AI ", "vector"],
  ] as const)("should_run_and_steer_to_keyword_for_%j_in_%s_mode", async (query, mode) => {
    expect(await run(query, mode)).toEqual({ isError: false, steers: true });
  });

  it.each([
    ["DDD", "hybrid"],
    ["Go", "keyword"],
  ] as const)("should_add_no_short_query_note_for_%j_in_%s_mode", async (query, mode) => {
    expect(await run(query, mode)).toEqual({ isError: false, steers: false });
  });
});
