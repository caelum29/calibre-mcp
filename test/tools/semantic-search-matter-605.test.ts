// #605 output: every non-body hit is labelled in both channels and both scopes — a text label in
// the match/passage line and a `matterKind` field in structuredContent (absent for body), with
// `frontMatter: true` kept for front matter for one release.

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

const ch = (i: number, body: string, matterKind: MatterKind, v: Float32Array): IndexedChunk => ({
  body,
  charStart: i * 100,
  charEnd: i * 100 + body.length,
  vector: v,
  matterKind,
});

/** One book per kind; each book's only chunk is on axis 0, so all score alike. */
function store(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  const kinds: MatterKind[] = ["body", "front", "back_index", "back_biblio", "back_other"];
  kinds.forEach((k, i) =>
    s.replaceBook(LIB, { bookId: i + 1, title: `Book ${i + 1}`, authors: ["A"] }, [
      ch(0, `ownership passage of kind ${k}`, k, axis(0)),
    ]),
  );
  // Book 9: one passage per kind, for book scope.
  s.replaceBook(
    LIB,
    { bookId: 9, title: "Mixed", authors: ["B"] },
    kinds.map((k, i) => ch(i, `ownership passage ${k}`, k, axis(0))),
  );
  return s;
}

const LABEL: Record<MatterKind, string> = {
  body: "",
  front: "[front matter]",
  back_index: "[back matter: index]",
  back_biblio: "[back matter: bibliography]",
  back_other: "[back matter: copyright/ads]",
};

const texts = (r: Awaited<ReturnType<typeof semanticSearchTool.handler>>) =>
  r.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text);

describe("matter labels and matterKind (#605)", () => {
  it("library scope: label in the MATCH line and matterKind in results, absent for body", async () => {
    const r = await semanticSearchTool.handler(
      { query: "ownership", scope: "library", mode: "vector", topK: 10 },
      deps(store()),
    );
    const results = (
      r.structuredContent as { results: Array<{ bookId: number; matterKind?: string; snippet: string }> }
    ).results;
    const byBook = new Map(results.map((x) => [x.bookId, x]));
    expect([1, 2, 3, 4, 5].map((id) => byBook.get(id)?.matterKind)).toEqual([
      undefined,
      "front",
      "back_index",
      "back_biblio",
      "back_other",
    ]);
    for (const [id, kind] of [
      [2, "front"],
      [3, "back_index"],
      [4, "back_biblio"],
      [5, "back_other"],
    ] as const) {
      const line = texts(r).find((t) => t.includes(`MATCH book ${id} `))!;
      expect(line.split("\n").find((l) => l.includes("MATCH book"))).toContain(LABEL[kind]);
      expect(byBook.get(id)!.snippet).toContain(LABEL[kind]);
    }
    expect(texts(r).find((t) => t.includes("MATCH book 1 "))).not.toContain("[");
  });

  it("book scope: label in the PASSAGE line, matterKind in passages, frontMatter kept for front", async () => {
    const r = await semanticSearchTool.handler(
      { query: "ownership", scope: "book", bookId: 9, mode: "vector", topK: 10 },
      deps(store()),
    );
    const passages = (
      r.structuredContent as { passages: Array<{ body: string; matterKind?: string; frontMatter?: boolean }> }
    ).passages;
    const of = (k: MatterKind) => passages.find((p) => p.body.includes(`ownership passage ${k}`))!;
    expect(
      (["body", "front", "back_index", "back_biblio", "back_other"] as const).map((k) => of(k).matterKind),
    ).toEqual([undefined, "front", "back_index", "back_biblio", "back_other"]);
    expect([of("front").frontMatter, of("back_index").frontMatter]).toEqual([true, undefined]);
    for (const k of ["front", "back_index", "back_biblio", "back_other"] as const) {
      const block = texts(r).find((t) => t.includes(`ownership passage ${k}`))!;
      expect(block.split("\n").find((l) => l.includes("PASSAGE @"))).toContain(LABEL[k]);
    }
  });
});
