// #693: the front_matter dual-write is over. A front passage carries only `matterKind: "front"`
// (no `frontMatter` key, in the output or its schema), and a fresh index has no front_matter column.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import type { MatterKind } from "../../src/domain/structure/matter-kind.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { type SemanticDeps, semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";
import { withLiveHitCheck } from "./fake-live-ids.js";

const LIB = "Programming_Books";

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

function deps(store: SqliteIndexStore): SemanticDeps {
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

const ch = (i: number, body: string, matterKind: MatterKind): IndexedChunk => ({
  body,
  charStart: i * 100,
  charEnd: i * 100 + body.length,
  vector: axis(0),
  matterKind,
});

describe("front_matter dual-write removed (#693)", () => {
  it("should_return_a_front_passage_with_matterKind_front_and_no_frontMatter_key", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    store.replaceBook(LIB, { bookId: 9, title: "Mixed", authors: ["B"] }, [
      ch(0, "ownership passage front", "front"),
      ch(1, "ownership passage body", "body"),
    ]);

    const r = await semanticSearchTool.handler(
      { query: "ownership", scope: "book", bookId: 9, mode: "vector", topK: 10 },
      deps(store),
    );

    const passages = (r.structuredContent as { passages: Record<string, unknown>[] }).passages;
    const front = passages.find((p) => String(p.body).includes("passage front"))!;
    expect({ matterKind: front.matterKind, hasFrontMatter: "frontMatter" in front }).toEqual({
      matterKind: "front",
      hasFrontMatter: false,
    });
  });

  it("should_not_declare_frontMatter_in_the_output_schema", () => {
    const passages = semanticSearchTool.outputSchema!.passages as unknown as {
      unwrap(): { element: { shape: Record<string, unknown> } };
    };
    expect(Object.keys(passages.unwrap().element.shape)).not.toContain("frontMatter");
  });

  it("should_create_a_fresh_index_without_a_front_matter_column", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-693-"));
    try {
      const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
      store.replaceBook(LIB, { bookId: 1, title: "Book", authors: ["A"] }, [ch(0, "contents", "front")]);
      store.close();
      const db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
      const cols = (db.prepare("PRAGMA table_info(chunks)").all() as { name: string }[]).map((c) => c.name);
      db.close();
      expect(cols).not.toContain("front_matter");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
