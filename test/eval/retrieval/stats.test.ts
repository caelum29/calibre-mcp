// Unit tests for the eval stats module (#358): exact sign test, sign-flip permutation test,
// bootstrap CI (fixed seed → deterministic), MDE, and the per-kind paired compare of two reports.

import { describe, expect, it } from "vitest";
import type { EvalReport, Mode, PerQueryRow, QueryKind } from "./harness.js";
import {
  compareReports,
  minDetectableEffect,
  pairedBootstrapCI,
  pairedPermutationTest,
  renderCompare,
  signTest,
} from "./stats.js";

describe("signTest (exact two-sided binomial on Hit@1 flips)", () => {
  it("9 wins vs 1 loss → 22/1024", () => {
    expect(signTest(9, 1)).toBe(22 / 1024);
  });
  it("0 vs 10 → 2/1024", () => {
    expect(signTest(0, 10)).toBe(2 / 1024);
  });
  it("a tie caps at 1", () => {
    expect(signTest(5, 5)).toBe(1);
  });
  it("no flips at all → 1", () => {
    expect(signTest(0, 0)).toBe(1);
  });
});

describe("pairedPermutationTest (sign-flip, two-sided)", () => {
  it("enumerates exactly for small n: ten equal positive diffs → 2/1024", () => {
    expect(pairedPermutationTest(Array(10).fill(1))).toBe(2 / 1024);
  });
  it("three equal diffs → 2/8", () => {
    expect(pairedPermutationTest([0.5, 0.5, 0.5])).toBe(0.25);
  });
  it("all-zero diffs → 1", () => {
    expect(pairedPermutationTest([0, 0, 0, 0])).toBe(1);
  });
  it("empty → 1", () => {
    expect(pairedPermutationTest([])).toBe(1);
  });
  it("Monte Carlo for large n is deterministic under the fixed seed", () => {
    const diffs = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? -0.2 : 0.3));
    const a = pairedPermutationTest(diffs);
    expect(pairedPermutationTest(diffs)).toBe(a);
    expect(a).toBeLessThan(0.01);
  });
});

describe("pairedBootstrapCI (percentile, fixed seed)", () => {
  it("constant diffs → a zero-width CI at that value", () => {
    const [lo, hi] = pairedBootstrapCI(Array(20).fill(0.3));
    expect(lo).toBe(hi);
    expect(lo).toBeCloseTo(0.3, 12);
  });
  it("is deterministic and brackets the mean", () => {
    const diffs = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const [lo, hi] = pairedBootstrapCI(diffs);
    expect(pairedBootstrapCI(diffs)).toEqual([lo, hi]);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
  });
  it("empty → [0, 0]", () => {
    expect(pairedBootstrapCI([])).toEqual([0, 0]);
  });
});

describe("minDetectableEffect (two-sided α=0.05, 80% power)", () => {
  it("reproduces the #358 numbers at n = 59", () => {
    expect(minDetectableEffect(0.24, 59)).toBeCloseTo(0.0875, 4);
    expect(minDetectableEffect(0.34, 59)).toBeCloseTo(0.124, 3);
  });
  it("n < 2 has no detectable effect", () => {
    expect(minDetectableEffect(0.2, 1)).toBe(Number.POSITIVE_INFINITY);
  });
});

function row(id: string, kind: QueryKind, mode: Mode, hit1: 0 | 1, ndcg10: number): PerQueryRow {
  return {
    id,
    kind,
    scope: "library",
    mode,
    ru: false,
    retrieved: [],
    metrics: { hit1, recall5: hit1, rr: hit1, ndcg10 },
  };
}

function report(rows: PerQueryRow[]): EvalReport {
  return {
    meta: { modes: ["hybrid"] } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
  };
}

describe("compareReports", () => {
  const a = report([
    row("sp-1", "semantic-paraphrase", "hybrid", 1, 1),
    row("sp-2", "semantic-paraphrase", "hybrid", 0, 0.5),
    row("sp-3", "semantic-paraphrase", "hybrid", 0, 0),
    row("id-1", "exact-identifier", "hybrid", 1, 1),
    row("id-2", "exact-identifier", "hybrid", 1, 1),
    { id: "neg-1", kind: "negative", scope: "library", mode: "hybrid", ru: false, retrieved: [], flagged: true },
  ]);
  const b = report([
    row("sp-1", "semantic-paraphrase", "hybrid", 1, 1),
    row("sp-2", "semantic-paraphrase", "hybrid", 1, 1),
    row("sp-3", "semantic-paraphrase", "hybrid", 1, 1),
    row("id-1", "exact-identifier", "hybrid", 1, 1),
    row("id-2", "exact-identifier", "hybrid", 0, 0.5),
    { id: "neg-1", kind: "negative", scope: "library", mode: "hybrid", ru: false, retrieved: [], flagged: true },
  ]);
  const rows = compareReports(a, b);

  it("emits overall then each kind (alphabetical), negatives excluded", () => {
    expect(rows.map((r) => `${r.mode}/${r.group}`)).toEqual([
      "hybrid/overall",
      "hybrid/exact-identifier",
      "hybrid/semantic-paraphrase",
    ]);
  });

  it("pairs by query id: n, means, Δ nDCG, Hit@1 flips, sign p, headroom", () => {
    const o = rows[0]!;
    expect([o.n, o.meanA, o.meanB, o.delta]).toEqual([5, 0.7, 0.9, 0.2]);
    expect([o.hit1Wins, o.hit1Losses, o.signP]).toEqual([2, 1, 1]);
    expect(o.headroom).toBe(0.4); // sp-1, id-1 solved by both
    // diffs [0, 0.5, 1, 0, -0.5]: 24 of 32 sign patterns reach |sum| >= 1
    expect(o.p).toBe(0.75);
    // sample SD of the diffs = sqrt(1.3 / 4); MDE = 2.801585 · SD / sqrt(5)
    expect(o.mde).toBeCloseTo(0.7143, 4);
    const sp = rows[2]!;
    expect([sp.n, sp.delta, sp.hit1Wins, sp.hit1Losses]).toEqual([3, 0.5, 2, 0]);
    expect(sp.p).toBe(0.5); // diffs [0, 0.5, 1]: 4 of 8 sign patterns reach |mean| >= 0.5
  });

  it("flags rows whose |Δ| is below the MDE as underpowered", () => {
    expect(rows.map((r) => r.underpowered)).toEqual([true, true, true]);
  });

  it("renders one aligned line per row with Δ, CI, p, flips, MDE and the flag", () => {
    const text = renderCompare(
      [
        {
          mode: "hybrid",
          group: "overall",
          n: 59,
          meanA: 0.851,
          meanB: 0.906,
          delta: 0.055,
          ci: [-0.002, 0.118],
          p: 0.0612,
          hit1Wins: 4,
          hit1Losses: 3,
          signP: 1,
          mde: 0.0876,
          underpowered: true,
          headroom: 0.7288,
        },
        {
          mode: "vector",
          group: "cross-lingual",
          n: 8,
          meanA: 0.2,
          meanB: 0.9,
          delta: 0.7,
          ci: [0.5, 0.85],
          p: 0.0078,
          hit1Wins: 7,
          hit1Losses: 0,
          signP: 0.015625,
          mde: 0.31,
          underpowered: false,
          headroom: 0.125,
        },
      ],
      "a.json",
      "b.json",
    );
    expect(text.split("\n")).toEqual([
      "compare b.json − a.json (paired by query id; Δ = nDCG@10 b − a; flips = Hit@1 wins/losses for b)",
      "mode     group                  n   meanA  meanB       Δ  95% CI              perm p  flips  sign p    MDE  headroom  note",
      "hybrid   overall               59   0.851  0.906  +0.055  [-0.002, +0.118]    0.0612    4/3  1.0000  0.088     72.9%  UNDERPOWERED",
      "vector   cross-lingual          8   0.200  0.900  +0.700  [+0.500, +0.850]    0.0078    7/0  0.0156  0.310     12.5%",
    ]);
  });
});
