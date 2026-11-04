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

/** One vector hit per entry of `cosines` in every scope; the reranker (if any) scores every pair `rerank`. */
function deps(cosines: number[], rerank: number | undefined | "throws"): RetrievalDeps {
  const index = {
    searchLibrary: () =>
      cosines.map((score, i) => ({
        bookId: i + 1,
        title: "T",
        authors: ["A"],
        score,
        charStart: 0,
        charEnd: 1,
        snippet: "s",
        body: "b",
      })),
    searchLibraryFts: () => [],
    searchBook: () =>
      cosines.map((score, i) => ({ chunkId: i + 1, charStart: 0, charEnd: 1, body: "b", score, frontMatter: false })),
    searchBookFts: () => [],
    chunkAt: () => undefined,
    searchFigures: () =>
      cosines.map((score, i) => ({
        figureId: i + 1,
        bookId: 1,
        title: "T",
        authors: ["A"],
        figIndex: i + 1,
        page: 1,
        caption: "c",
        charOffset: 0,
        format: "epub",
        score,
      })),
    searchFiguresFts: () => [],
    figureCount: () => 0,
    figuresInSpan: () => [],
  } satisfies ChunkIndex & FigureIndex;
  const reranker: Reranker | undefined =
    rerank === undefined
      ? undefined
      : {
          rerank: async (_q, ps) => {
            if (rerank === "throws") throw new Error("RERANKER_UNAVAILABLE");
            return ps.map(() => rerank);
          },
          warmup: async () => {},
        };
  return {
    index,
    embedder: { embedQuery: async () => new Float32Array(4) } as unknown as RetrievalDeps["embedder"],
    ...(reranker ? { reranker } : {}),
    config: { rerankEnabled: true, semanticFloor: loadConfig({}).semanticFloor },
    log,
  };
}

/** Each scope through its own retrieve() overload — the three real call sites. */
function run(scope: Scope, d: RetrievalDeps, topK: number) {
  const base = { libraryId: "L", query: "q", mode: "vector", topK } as const;
  if (scope === "library") return retrieve(d, { ...base, scope });
  if (scope === "book") return retrieve(d, { ...base, scope, bookId: 1 });
  return retrieve(d, { ...base, scope });
}

// cosine floor 0.78 (library/book only) and rerank floor 0.3; `figures` has no cosine floor yet.
// Both floors are strict "<": a score exactly AT a floor is not low. `max` = the best cosine.
type Row = [cosines: number[], rerank: number | undefined, max: number, expected: Record<Scope, boolean>];
const ALL_OK = { library: false, book: false, figures: false };
const ALL_LOW = { library: true, book: true, figures: true };
const COSINE_LOW = { library: true, book: true, figures: false };
const CASES: Row[] = [
  [[0.9], 0.5, 0.9, ALL_OK],
  [[0.9], 0.2, 0.9, ALL_LOW],
  [[0.7], 0.5, 0.7, COSINE_LOW],
  [[0.7], 0.2, 0.7, ALL_LOW],
  [[0.9], undefined, 0.9, ALL_OK],
  [[0.7], undefined, 0.7, COSINE_LOW],
  // exactly at the cosine floor / the rerank floor: not low (a "<" turned "<=" would flip these)
  [[0.78], 0.5, 0.78, ALL_OK],
  [[0.9], 0.3, 0.9, ALL_OK],
  // several hits: confidence follows the BEST cosine, wherever it sits (Math.max, not first/min)
  [[0.7, 0.9], 0.5, 0.9, ALL_OK],
  [[0.9, 0.7], 0.5, 0.9, ALL_OK],
  [[0.7, 0.6], undefined, 0.7, COSINE_LOW],
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
    CASES.flatMap(([cosines, rerank, max, expected]) =>
      SCOPES.map((scope) => [scope, cosines, rerank, max, expected[scope]] as const),
    ),
  )(
    "%s: cosines %j, rerank %s → max %s, lowConfidence %s, and the replay agrees",
    async (scope, cosines, rerank, max, expected) => {
      const r = await run(scope, deps(cosines, rerank), cosines.length);
      const replay = flagged(
        {
          target: scope === "figures" ? "figures" : "library",
          maxScore: r.maxScore,
          maxRerank: r.maxRerank,
        } as PerQueryRow,
        RERANK_FLOOR,
      );
      expect({ maxScore: r.maxScore, maxRerank: r.maxRerank, low: r.lowConfidence, replay }).toEqual({
        maxScore: max,
        maxRerank: rerank,
        low: expected,
        replay: expected,
      });
    },
  );

  // A reranker that throws degrades to the fused order: no rerank score is claimed, so confidence
  // rests on the cosine half alone (a stale rerank value must never flag a result).
  it.each([
    ["library", 0.9, false],
    ["library", 0.7, true],
    ["book", 0.9, false],
    ["book", 0.7, true],
    ["figures", 0.9, false],
    ["figures", 0.7, false],
  ] as const)("%s: a failing reranker, cosine %s → lowConfidence %s, no maxRerank", async (scope, cosine, expected) => {
    const r = await run(scope, deps([cosine], "throws"), 1);
    expect({ reranked: r.reranked, maxRerank: r.maxRerank, low: r.lowConfidence }).toEqual({
      reranked: false,
      maxRerank: undefined,
      low: expected,
    });
  });
});
