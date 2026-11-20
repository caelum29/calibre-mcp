// A description hit (#631) has no place in the book, so it carries no `section:` / `page:` line and
// no sectionPath / page field (ADR-0034, #708), even when its book has sections and pages at offset 0.

import { describe, expect, it } from "vitest";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { semanticSearchTool, type SemanticDeps } from "../../src/tools/calibre_semantic_search.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";
import { withLiveHitCheck } from "./fake-live-ids.js";

const LIB = "Programming_Books";

function vec(...axes: number[]): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  for (const i of axes) v[i] = 1;
  return l2normalize(v);
}

const embedder: Embedder = {
  async embedQuery() {
    return vec(0);
  },
  async embedPassages(texts) {
    return texts.map(() => vec(0));
  },
  async warmup() {},
  countTokens: (s) => s.length,
};

// Book 2: a two-page PDF with a section at 0, its chunk off the query axis and pushed out of the
// vector pool by 50 fillers; only its metadata row sits on the query axis.
const PDF = "Cover page\fChapter one text";

function store(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  s.replaceBook(
    LIB,
    { bookId: 2, title: "Professional Equids", authors: ["Bob"] },
    [{ body: PDF, charStart: 0, charEnd: PDF.length, vector: vec(5) }],
    [],
    {
      sections: {
        source: "pdf-outline",
        sections: [{ title: "Cover", level: 1, charStart: 0, charEnd: PDF.length, parent: null, matterKind: "body" }],
      },
      metadata: { text: "Professional Equids\nBob\n\nThe complete guide to zebras.", blurbChars: 29, vector: vec(0) },
    },
  );
  for (let id = 101; id <= 150; id++) {
    s.replaceBook(LIB, { bookId: id, title: `Filler ${id}`, authors: [] }, [
      { body: `filler text ${id}`, charStart: 0, charEnd: 15, vector: vec(0, 1) },
    ]);
  }
  return s;
}

function deps(): SemanticDeps {
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
    index: store(),
    log,
    retrievalOptions: { rrfWeights: [1, 1, 1] },
  };
}

describe("description hits carry no section or page (#631 × #708)", () => {
  it("prints no section: or page: line and declares neither field on the description hit", async () => {
    const r = await semanticSearchTool.handler(
      { query: "zebras", scope: "library", mode: "hybrid", topK: 3 } as never,
      deps(),
    );
    const results = r.structuredContent!.results as Array<Record<string, unknown>>;
    const hit = results.find((h) => h.bookId === 2)!;
    const block = r.content.map((b) => ("text" in b ? b.text : "")).find((t) => t.includes("MATCH book 2"))!;
    expect([hit.snippetSource, "sectionPath" in hit, "page" in hit, /^(section|page): /m.test(block)]).toEqual([
      "description",
      false,
      false,
      false,
    ]);
  });
});
