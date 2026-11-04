// Edge cases for the eval saturation signals (#365 review): fusion-only runs labelled ON never
// warn, a query missing from a mode is not "solved", and live runs skip both signals.

import { describe, expect, it } from "vitest";
import type { EvalReport, Mode, PerQueryRow } from "./harness.js";
import { headroom, saturationLines, saturationWarning } from "./saturation.js";

const ON = "onnx-community/bge-reranker-v2-m3-ONNX q8";

function hit(id: string, mode: Mode, hit1: 0 | 1): PerQueryRow {
  return {
    id,
    kind: "semantic-paraphrase",
    scope: "library",
    mode,
    ru: false,
    retrieved: [],
    metrics: { hit1, recall5: hit1, rr: hit1, ndcg10: hit1 },
  };
}

function report(meta: Partial<EvalReport["meta"]>, hybridHit1: number, perQuery: PerQueryRow[] = []): EvalReport {
  return {
    meta: { modes: ["hybrid"], rerank: ON, rerankedRows: 59, live: false, ...meta } as EvalReport["meta"],
    overall: { hybrid: { n: 59, hit1: hybridHit1, recall5: 1, mrr: 1, ndcg10: 1 } },
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery,
  };
}

describe("saturationWarning on fusion-only runs", () => {
  it("is silent when the reranker was ON but reranked 0 rows (model failed to load)", () => {
    expect(saturationWarning(report({ rerankedRows: 0 }, 1))).toBeUndefined();
  });

  it("is silent for the harness's 'off (no reranker wired)' label", () => {
    expect(saturationWarning(report({ rerank: "off (no reranker wired)", rerankedRows: 0 }, 1))).toBeUndefined();
  });

  it("still warns for an ON run that reranked rows", () => {
    expect(saturationWarning(report({ rerankedRows: 1 }, 0.96))).toBe(
      "WARNING: eval saturated — rerank-ON hybrid Hit@1 0.960 >= 0.95; optimise cost/latency or add harder queries (#365)",
    );
  });
});

describe("headroom with missing mode rows", () => {
  it("does not count a query as solved when a run mode has no row for it", () => {
    const modes: Mode[] = ["hybrid", "vector"];
    // q1 solved in both; q2 has only a hybrid row (vector missing) -> not solved by all
    const perQuery = [hit("q1", "hybrid", 1), hit("q1", "vector", 1), hit("q2", "hybrid", 1)];
    expect(headroom(report({ modes }, 1, perQuery))).toEqual({ positives: 2, solvedByAll: 1, share: 0.5 });
  });
});

describe("saturationLines", () => {
  it("skips headroom and the warning on --live runs", () => {
    const perQuery = [hit("q1", "hybrid", 1)];
    expect(saturationLines(report({ live: true }, 1, perQuery))).toEqual([
      "headroom: skipped on --live (unverified labels)",
    ]);
  });

  it("prints headroom then the warning on a saturated fixture run", () => {
    const perQuery = [hit("q1", "hybrid", 1), hit("q2", "hybrid", 0)];
    expect(saturationLines(report({}, 0.95, perQuery))).toEqual([
      "headroom: 1/2 positives solved at Hit@1 by every mode (50.0%)",
      "WARNING: eval saturated — rerank-ON hybrid Hit@1 0.950 >= 0.95; optimise cost/latency or add harder queries (#365)",
    ]);
  });

  it("prints only headroom when not saturated", () => {
    const perQuery = [hit("q1", "hybrid", 1)];
    expect(saturationLines(report({}, 0.9492, perQuery))).toEqual([
      "headroom: 1/1 positives solved at Hit@1 by every mode (100.0%)",
    ]);
  });
});
