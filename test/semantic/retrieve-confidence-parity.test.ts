// retrieve()'s confidence signals (maxScore, lowConfidence) at the three real call sites
// (library / book / figures) must equal the eval scorer's offline replay (`flagged()` in
// test/eval/retrieval/rerank-floor.ts), which re-implements the rule and hard-codes the
// cosine floor. Without this the RERANK_FLOOR recalibration could tune a rule the tool no longer uses (#366).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { RERANK_FLOOR, type Reranker } from "../../src/semantic/reranker.js";
import { retrieve, type RetrievalDeps } from "../../src/semantic/retrieve.js";
import type { ChunkIndex, FigureIndex } from "../../src/semantic/store/index.js";
import type { PerQueryRow } from "../eval/retrieval/harness.js";
import { flagged } from "../eval/retrieval/rerank-floor.js";

const SCOPES = ["library", "book", "figures"] as const;
type Scope = (typeof SCOPES)[number];

/** One vector hit of every scope, all at `cosine`; the reranker (if any) scores every pair `rerank`. */
function deps(cosine: number, rerank: number | undefined): RetrievalDeps {
  const index = {
    searchLibrary: () => [
      { bookId: 1, title: "T", authors: ["A"], score: cosine, charStart: 0, charEnd: 1, snippet: "s", body: "b" },
    ],
    searchLibraryFts: () => [],
    searchBook: () => [{ chunkId: 1, charStart: 0, charEnd: 1, body: "b", score: cosine, frontMatter: false }],
    searchBookFts: () => [],
    chunkAt: () => undefined,
    searchFigures: () => [
      {
        figureId: 1,
        bookId: 1,
        title: "T",
        authors: ["A"],
        figIndex: 1,
        page: 1,
        caption: "c",
        charOffset: 0,
        format: "epub",
        score: cosine,
      },
    ],
    searchFiguresFts: () => [],
    figureCount: () => 0,
    figuresInSpan: () => [],
  } satisfies ChunkIndex & FigureIndex;
  const reranker: Reranker | undefined =
    rerank === undefined ? undefined : { rerank: async (_q, ps) => ps.map(() => rerank), warmup: async () => {} };
  return {
    index,
    embedder: { embedQuery: async () => new Float32Array(4) } as unknown as RetrievalDeps["embedder"],
    ...(reranker ? { reranker } : {}),
    config: { rerankEnabled: true, semanticFloor: loadConfig({}).semanticFloor },
    log,
  };
}

/** Each scope through its own retrieve() overload — the three real call sites. */
function run(scope: Scope, d: RetrievalDeps) {
  const base = { libraryId: "L", query: "q", mode: "vector", topK: 1 } as const;
  if (scope === "library") return retrieve(d, { ...base, scope });
  if (scope === "book") return retrieve(d, { ...base, scope, bookId: 1 });
  return retrieve(d, { ...base, scope });
}

// cosine floor 0.78 (library/book only) and rerank floor 0.3; `figures` has no cosine floor yet.
const CASES: Array<[cosine: number, rerank: number | undefined, expected: Record<Scope, boolean>]> = [
  [0.9, 0.5, { library: false, book: false, figures: false }],
  [0.9, 0.2, { library: true, book: true, figures: true }],
  [0.7, 0.5, { library: true, book: true, figures: false }],
  [0.7, 0.2, { library: true, book: true, figures: true }],
  [0.9, undefined, { library: false, book: false, figures: false }],
  [0.7, undefined, { library: true, book: true, figures: false }],
];

describe("retrieve() confidence vs the eval scorer's replay (#366)", () => {
  it("the scorer's hard-coded cosine floor is the config default", () => {
    // flagged() at the cosine boundary: 0.78 is not low, just under it is
    const at = (maxScore: number) => flagged({ target: "library", maxScore } as PerQueryRow, RERANK_FLOOR);
    expect([at(loadConfig({}).semanticFloor), at(loadConfig({}).semanticFloor - 0.0001)]).toEqual([false, true]);
  });

  it("the scorer's currentFloor in thresholds.json is the real RERANK_FLOOR", () => {
    const file = new URL("../eval/retrieval/thresholds.json", import.meta.url);
    const t = JSON.parse(readFileSync(file, "utf8")) as { rerankFloor: { currentFloor: number } };
    expect(t.rerankFloor.currentFloor).toBe(RERANK_FLOOR);
  });

  it.each(
    CASES.flatMap(([cosine, rerank, expected]) =>
      SCOPES.map((scope) => [scope, cosine, rerank, expected[scope]] as const),
    ),
  )("%s: cosine %s, rerank %s → lowConfidence %s, and the replay agrees", async (scope, cosine, rerank, expected) => {
    const r = await run(scope, deps(cosine, rerank));
    const replay = flagged(
      {
        target: scope === "figures" ? "figures" : "library",
        maxScore: r.maxScore,
        maxRerank: r.maxRerank,
      } as PerQueryRow,
      RERANK_FLOOR,
    );
    expect({ maxScore: r.maxScore, maxRerank: r.maxRerank, low: r.lowConfidence, replay }).toEqual({
      maxScore: cosine,
      maxRerank: rerank,
      low: expected,
      replay: expected,
    });
  });
});
