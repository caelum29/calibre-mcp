// #559: a requested keyword-only build (or a keyword-only index) with the embedding model PRESENT
// steers to a normal rebuild, never to "not installed"; install text only when the model is
// really missing. build_index's semanticAvailable reports the model, not the build mode.

import { describe, expect, it } from "vitest";
import { buildIndexTool, type BuildIndexDeps } from "../../src/tools/calibre_build_index.js";
import { semanticSearchTool, type SemanticDeps } from "../../src/tools/calibre_semantic_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder, EmbedderLoadState } from "../../src/semantic/embedder.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import type { ToolResult } from "../../src/tools/types.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";

const LIB = "Programming_Books";
const NOT_INSTALLED = "is not installed";

const unit = () => {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return l2normalize(v);
};

/** An embedder whose in-process load state is `state`: "loaded" = usable, "failed" = not. */
function embedder(state: EmbedderLoadState): Embedder {
  const fail = () => {
    throw new Error("EMBEDDER_UNAVAILABLE");
  };
  return state === "loaded"
    ? {
        async embedQuery() {
          return unit();
        },
        async embedPassages(t: string[]) {
          return t.map(unit);
        },
        async warmup() {},
        countTokens: (s: string) => Math.ceil(s.length / 4) + 2,
        loadState: () => state,
      }
    : { embedQuery: fail, embedPassages: fail, warmup: fail, countTokens: fail, loadState: () => state };
}

const book: Book = {
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

function buildDeps(e: Embedder): BuildIndexDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: fakeContent({ getBook: async () => book, resolveLibraryId: async () => asLibId(LIB) }),
    calibre: fakeCalibre(),
    extractor: fakeExtractor({
      getText: async (): Promise<ExtractedText> => ({
        text: "Ownership and borrowing. ".repeat(200),
        backend: "pdftotext",
        chars: 5000,
        cached: false,
        markers: [],
        unplaced: 0,
        outline: [],
        epubToc: null,
      }),
    }),
    figures: fakeFigures(),
    embedder: e,
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
}

const buildArgs = (over: Record<string, unknown>) => ({
  force: false,
  enableFts: false,
  keywordOnly: false,
  prune: false,
  ...over,
});

/** A keyword-only index: chunks, no vectors. */
function keywordOnlyStore(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  s.replaceBook(LIB, { bookId: 1, title: "Book One", authors: ["A"] }, [
    { charStart: 0, charEnd: 15, body: "ownership rules" },
  ]);
  return s;
}

function searchDeps(e: Embedder): SemanticDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: fakeContent({
      virtualLibraries: async () => ({}),
      resolveLibraryId: async () => asLibId(LIB),
      search: async () => ({ bookIds: [], total: 0, num: 0, offset: 0, sort: "", libraryId: LIB }),
    }),
    calibre: fakeCalibre({ calibredb: async () => ({ stdout: "", stderr: "" }) }),
    extractor: fakeExtractor(),
    figures: fakeFigures(),
    embedder: e,
    index: keywordOnlyStore(),
    log,
  };
}

const searchArgs = (over: Record<string, unknown>) => ({
  query: "ownership",
  scope: "library" as const,
  mode: "hybrid" as const,
  topK: 10,
  ...over,
});

const text = (r: ToolResult) => r.content.map((b) => (b as { text?: string }).text ?? "").join("\n");

describe("calibre_build_index keywordOnly=true steer (#559)", () => {
  it("should_steer_to_a_normal_rebuild_without_install_text_when_the_model_is_present", async () => {
    const r = await buildIndexTool.handler(buildArgs({ bookId: 1, keywordOnly: true }), buildDeps(embedder("loaded")));
    expect(r.isError).toBeFalsy();
    expect(text(r)).not.toContain(NOT_INSTALLED);
    expect(text(r)).toContain(
      'Keyword-only index (no embeddings): mode:"keyword" search works now. The embedding model is available: for vector & hybrid semantic search, rebuild without keywordOnly (force=true).',
    );
    expect(r.structuredContent).toMatchObject({ keywordOnly: true, semanticAvailable: true });
    expect(r.structuredContent?.semanticReason).toBe(
      "keywordOnly=true requested — no embeddings built; the embedding model is available, so a rebuild without keywordOnly (force=true) enables vector & hybrid search.",
    );
  });

  it("should_keep_the_install_text_and_report_unavailable_when_the_model_is_missing", async () => {
    const r = await buildIndexTool.handler(buildArgs({ bookId: 1, keywordOnly: true }), buildDeps(embedder("failed")));
    expect(text(r)).toContain(NOT_INSTALLED);
    expect(r.structuredContent).toMatchObject({ keywordOnly: true, semanticAvailable: false });
  });

  it("should_report_unavailable_with_install_text_on_an_auto_degrade", async () => {
    const r = await buildIndexTool.handler(buildArgs({ bookId: 1 }), buildDeps(embedder("failed")));
    expect(text(r)).toContain(NOT_INSTALLED);
    expect(r.structuredContent).toMatchObject({ keywordOnly: true, semanticAvailable: false });
  });

  it("should_report_available_on_an_embedding_build", async () => {
    const r = await buildIndexTool.handler(buildArgs({ bookId: 1 }), buildDeps(embedder("loaded")));
    expect(r.structuredContent).toMatchObject({ keywordOnly: false, semanticAvailable: true });
  });
});

describe("calibre_semantic_search on a keyword-only index (#559)", () => {
  it("should_steer_vector_mode_to_a_rebuild_without_install_text_when_the_model_is_present", async () => {
    const r = await semanticSearchTool.handler(searchArgs({ mode: "vector" }), searchDeps(embedder("loaded")));
    expect(r.isError).toBe(true);
    expect(text(r)).not.toContain(NOT_INSTALLED);
    expect(text(r)).toContain(
      'This index was built keyword-only (no embeddings), so vector search is unavailable. The embedding model is available: rebuild with calibre_build_index { force: true } (without keywordOnly), or use mode:"keyword" now.',
    );
  });

  it("should_steer_the_hybrid_degrade_note_to_a_rebuild_without_install_text_when_the_model_is_present", async () => {
    const r = await semanticSearchTool.handler(searchArgs({ mode: "hybrid" }), searchDeps(embedder("loaded")));
    const note =
      "Index is keyword-only (no embeddings) — showing keyword (FTS) matches. For semantic ranking, rebuild with calibre_build_index force=true (the embedding model is available).";
    expect(r.structuredContent?.note).toBe(note);
    expect(text(r)).toContain(note);
    expect(text(r)).not.toContain(NOT_INSTALLED);
  });

  it("should_keep_the_install_text_when_the_model_is_missing", async () => {
    const r = await semanticSearchTool.handler(searchArgs({ mode: "vector" }), searchDeps(embedder("failed")));
    expect(text(r)).toContain(NOT_INSTALLED);
  });
});
