// Unit tests for the eval metrics — including the "shuffle degrades the numbers" proof
// that the harness actually measures ranking quality (prompt 04 validation step).

import { describe, expect, it } from "vitest";
import {
  aggregate,
  hitAt1,
  ndcgAtK,
  queryMetrics,
  recallAtK,
  reciprocalRank,
  type RankedRelevance,
} from "./metrics.js";

/** Ranking where position i is relevant iff rel[i] is truthy; one label per hit. */
function rel(flags: number[], relevantCount = 1): RankedRelevance {
  return {
    matches: flags.map((f, i) => (f ? [`label-${i}`] : [])),
    relevantCount,
  };
}

describe("retrieval metrics", () => {
  it("hitAt1 is 1 only when the top result is relevant", () => {
    expect(hitAt1(rel([1, 0, 0]))).toBe(1);
    expect(hitAt1(rel([0, 1, 0]))).toBe(0);
    expect(hitAt1(rel([]))).toBe(0);
  });

  it("recallAtK counts distinct labels found in the top k", () => {
    // Two labels, one found at rank 2 within k=5 → recall 0.5.
    const r: RankedRelevance = { matches: [[], ["a"], [], [], []], relevantCount: 2 };
    expect(recallAtK(r, 5)).toBe(0.5);
  });

  it("recallAtK does not double-count a label matched by two positions", () => {
    const r: RankedRelevance = { matches: [["a"], ["a"]], relevantCount: 2 };
    expect(recallAtK(r, 5)).toBe(0.5);
  });

  it("reciprocalRank is 1/rank of the first relevant result", () => {
    expect(reciprocalRank(rel([0, 0, 1]))).toBeCloseTo(1 / 3);
    expect(reciprocalRank(rel([0, 0, 0]))).toBe(0);
  });

  it("ndcgAtK is 1 for a perfect ranking and less for a demoted one", () => {
    expect(ndcgAtK(rel([1]), 10)).toBe(1);
    const demoted = ndcgAtK(rel([0, 0, 0, 1]), 10);
    expect(demoted).toBeGreaterThan(0);
    expect(demoted).toBeLessThan(1);
  });

  it("shuffling a good ranking to the bottom moves every metric down (harness measures)", () => {
    const good = queryMetrics(rel([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const broken = queryMetrics(rel([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    expect(broken.hit1).toBeLessThan(good.hit1);
    expect(broken.recall5).toBeLessThan(good.recall5);
    expect(broken.rr).toBeLessThan(good.rr);
    expect(broken.ndcg10).toBeLessThan(good.ndcg10);
  });

  it("aggregate means each metric and reports n", () => {
    const agg = aggregate([queryMetrics(rel([1])), queryMetrics(rel([0, 1]))]);
    expect(agg.n).toBe(2);
    expect(agg.hit1).toBe(0.5);
    expect(agg.mrr).toBe(0.75);
  });

  it("aggregate of nothing is all zeros", () => {
    expect(aggregate([])).toEqual({ n: 0, hit1: 0, recall5: 0, mrr: 0, ndcg10: 0 });
  });
});
