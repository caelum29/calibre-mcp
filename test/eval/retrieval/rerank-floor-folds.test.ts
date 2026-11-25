// The rerank-floor scorer's 5-fold estimate (#632): the declared selection rule is re-run on four
// folds of the non-held-out fixture queries and the chosen floor's false-flag rate is measured on
// the fifth. The declared rule and its selection are unchanged; this only reports the estimate.

import { describe, expect, it } from "vitest";
import { kFold } from "./folds.js";
import type { EvalReport, PerQueryRow, QueryKind } from "./harness.js";
import { renderFloors, scoreFloors, type FloorThresholds } from "./rerank-floor.js";

const t: FloorThresholds = {
  candidates: [0.3, 0.1, 0.01],
  currentFloor: 0.3,
  population: { fixture: { modes: ["hybrid", "vector"] }, live: { modes: ["hybrid"] } },
  negativeSeparation: { kinds: ["negative", "figure-negative"], marginFactor: 0.5 },
};

function row(id: string, kind: QueryKind, maxRerank: number, mode: "hybrid" | "vector"): PerQueryRow {
  const metrics = kind === "negative" ? undefined : { hit1: 1, recall5: 1, rr: 1, ndcg10: 1 };
  return {
    id,
    kind,
    scope: "library",
    mode,
    ru: false,
    retrieved: [],
    reranked: true,
    maxScore: 0.85,
    maxRerank,
    ...(metrics ? { metrics } : {}),
  };
}

// sp-08 is held out (#632) and sits at 0.005: it must stay out of every fold
const SPEC: [string, QueryKind, number][] = [
  ...["sp-01", "sp-02", "sp-03", "sp-04", "sp-05", "sp-06", "sp-07", "sp-09"].map((id): [string, QueryKind, number] => [
    id,
    "semantic-paraphrase",
    0.05,
  ]),
  ["sp-10", "semantic-paraphrase", 0.008],
  ["sp-08", "semantic-paraphrase", 0.005],
  ["neg-01", "negative", 0.001],
  ["neg-02", "negative", 0.001],
];
// both modes: the unit is the query, so a query's two rows stay in one fold
const fixture = {
  perQuery: SPEC.flatMap(([id, k, r]) => [row(id, k, r, "hybrid"), row(id, k, r, "vector")]),
} as EvalReport;
const units = SPEC.filter(([id]) => id !== "sp-08").map(([id, k]) => ({ id, stratum: k }));

describe("rerank-floor 5-fold estimate", () => {
  const res = scoreFloors(t, fixture);
  const { folds } = kFold(units, 5);
  const est = res.foldEstimate!;

  it("folds the non-held-out queries, every mode of a query in one fold", () => {
    expect(est.perFold.map((f) => f.n)).toEqual(folds.map((f) => f.length));
    expect(folds.flat()).not.toContain("sp-08");
  });

  it("re-runs the declared selection on the other folds and scores the chosen floor on this one", () => {
    // every training set separates the negatives and adopts 0.01 (rate drop ≥ 0.15 vs 0.3)
    expect(est.perFold.map((f) => f.fitted)).toEqual([0.01, 0.01, 0.01, 0.01, 0.01]);
    // only sp-10 (0.008 < 0.01) is false-flagged, in its own test fold, in both modes
    const i10 = folds.findIndex((f) => f.includes("sp-10"));
    const positives = folds[i10]!.filter((id) => id.startsWith("sp-")).length;
    const rates = folds.map((_, i) => (i === i10 ? 1 / positives : 0));
    expect(est.perFold.map((f) => f.score)).toEqual(rates);
    expect(est.mean).toBeCloseTo(1 / positives / 5, 10);
  });

  it("leaves the declared selection itself unchanged", () => {
    expect(res.selected).toBe(0.01);
    expect(res.adopted).toBe(true);
  });

  it("renders the per-fold floor and rate and the mean ± SD", () => {
    const text = renderFloors(res);
    expect(text).toContain(
      "5-fold estimate (#632; declared selection fit on 4 folds of the non-held-out fixture queries, false-flag rate on the 5th):",
    );
    expect(
      text.split("\n").filter((l) => /^ {2}fold [1-5]: n \d+, floor 0\.01, false-flag rate \d+\.\d%$/.test(l)),
    ).toHaveLength(5);
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    expect(text).toContain(`  mean ± SD: ${pct(est.mean)} ± ${pct(est.sd)}`);
  });
});
