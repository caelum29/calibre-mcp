// Unit tests for the #142 sweep scorer: synthetic reports exercise the declared RU-up / EN
// non-regression gates and the selection rule (ship / 1.0 stays / adaptive-needed).

import { describe, expect, it } from "vitest";
import type { EvalReport, PerQueryRow, QueryKind } from "./harness.js";
import { scoreWeight, select, type SweepThresholds, type WeightReports } from "./rrf-sweep.js";

const t: SweepThresholds = {
  candidates: [1.0, 1.5],
  baselineWeight: 1.0,
  ruUp: {
    liveOn: { ruInvolvedNdcg10MinDelta: 0.01, crossLingualNdcg10MinDelta: 0.01 },
    fixtureOff: { ruInvolvedNdcg10MinDelta: 0.02, crossLingualNdcg10MinDelta: 0.02 },
    fixtureOn: { ruInvolvedNdcg10MinDelta: 0, crossLingualNdcg10MinDelta: 0 },
  },
  enNonRegression: {
    kinds: ["exact-identifier", "front-matter-trap"],
    liveOn: { kinds: ["exact-identifier"], maxNdcg10Drop: 0.02, maxBrokenHit1Queries: 0 },
    fixtureOff: { maxNdcg10Drop: 0.01, maxBrokenHit1Queries: 0 },
    fixtureOn: { maxNdcg10Drop: 0.01, maxBrokenHit1Queries: 0 },
  },
  zeroBroken: { modes: ["hybrid"] },
};

const agg = (ndcg10: number) => ({ hybrid: { n: 1, hit1: ndcg10, recall5: 1, mrr: ndcg10, ndcg10 } });

function row(id: string, kind: QueryKind, hit1: number): PerQueryRow {
  return {
    id,
    kind,
    scope: "library",
    mode: "hybrid",
    ru: false,
    retrieved: [],
    metrics: { hit1, recall5: 1, rr: hit1, ndcg10: hit1 },
  };
}

/** Report with given RU / cross-lingual / exact-identifier nDCG and per-query exact-id Hit@1. */
function report(ru: number, xl: number, exact: number, exactHit1 = 1): EvalReport {
  return {
    meta: { modes: ["hybrid"] } as EvalReport["meta"],
    overall: {},
    ruInvolved: agg(ru),
    byKind: { "cross-lingual": agg(xl), "exact-identifier": agg(exact) },
    negatives: {},
    figureNegatives: {},
    perQuery: [row("id-01", "exact-identifier", exactHit1)],
  };
}

const triple = (ru: number, xl: number, exact: number, exactHit1 = 1): WeightReports => ({
  fixtureOn: report(1, 1, 1),
  fixtureOff: report(ru, xl, exact, exactHit1),
  liveOn: report(ru, xl, exact, exactHit1),
});

const green = { pass: true, detail: "PASS" };

describe("rrf sweep scorer", () => {
  const base = triple(0.5, 0.5, 1);

  it("passes a weight that lifts RU without hurting EN", () => {
    const v = scoreWeight(1.5, base, triple(0.6, 0.6, 1), t, green);
    expect(v.pass).toBe(true);
    expect(select([scoreWeight(1.0, base, base, t, green), v], 1.0)).toEqual({ kind: "ship", weight: 1.5 });
  });

  it("fails RU-up when the lift is below the declared minimum", () => {
    const v = scoreWeight(1.5, base, triple(0.505, 0.505, 1), t, green);
    expect(v.ruPass).toBe(false);
    expect(select([v], 1.0)).toMatchObject({ kind: "stay" });
  });

  it("fails EN on a broken exact-identifier Hit@1 even when nDCG barely moves", () => {
    const v = scoreWeight(1.5, base, triple(0.6, 0.6, 0.995, 0), t, green);
    expect(v.ruPass).toBe(true);
    expect(v.enPass).toBe(false);
    expect(select([v], 1.0)).toMatchObject({ kind: "adaptive-needed" });
  });

  it("fails on a red zero-broken gate", () => {
    const v = scoreWeight(1.5, base, triple(0.6, 0.6, 1), t, { pass: false, detail: "FAIL" });
    expect(v.pass).toBe(false);
  });

  it("breaks liveOn-RU ties toward the smaller weight", () => {
    const a = scoreWeight(1.25, base, triple(0.6, 0.6, 1), t, green);
    const b = scoreWeight(2.0, base, triple(0.6, 0.6, 1), t, green);
    expect(select([b, a], 1.0)).toEqual({ kind: "ship", weight: 1.25 });
  });
});
