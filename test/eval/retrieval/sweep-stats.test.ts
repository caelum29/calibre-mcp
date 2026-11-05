// #358: the tuning scorers (rrf-sweep.ts, rerank-floor.ts) report paired statistics from the
// shared stats.ts path (permutation p, bootstrap CI, sign test, MDE / UNDERPOWERED) next to
// their declared gates, instead of bare aggregate deltas. Gate verdicts are unchanged.

import { describe, expect, it } from "vitest";
import type { EvalReport, PerQueryRow, QueryKind } from "./harness.js";
import { scoreFloors, type FloorThresholds } from "./rerank-floor.js";
import { scoreWeight, type SweepThresholds, type WeightReports } from "./rrf-sweep.js";
import { compareReports, formatPaired, type CompareRow } from "./stats.js";

function row(id: string, kind: QueryKind, ndcg10: number, ru = false): PerQueryRow {
  const hit1 = ndcg10 === 1 ? 1 : 0;
  return {
    id,
    kind,
    scope: "library",
    mode: "hybrid",
    ru,
    retrieved: [],
    metrics: { hit1, recall5: hit1, rr: hit1, ndcg10 },
  };
}

function report(rows: PerQueryRow[], aggregates: Partial<EvalReport> = {}): EvalReport {
  return {
    meta: { modes: ["hybrid"] } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
    ...aggregates,
  };
}

describe("compareReports extra groups", () => {
  // r1, r2 RU cross-lingual; e1 EN exact-identifier. b solves r1.
  const a = report([
    row("r1", "cross-lingual", 0, true),
    row("r2", "cross-lingual", 0, true),
    row("e1", "exact-identifier", 1),
  ]);
  const b = report([
    row("r1", "cross-lingual", 1, true),
    row("r2", "cross-lingual", 0, true),
    row("e1", "exact-identifier", 1),
  ]);

  it("adds named subset rows after overall, before the kinds", () => {
    const rows = compareReports(a, b, { "ru-involved": (r) => r.ru });
    expect(rows.map((r) => [r.group, r.n, r.delta, r.hit1Wins, r.hit1Losses])).toEqual([
      ["overall", 3, 1 / 3, 1, 0],
      ["ru-involved", 2, 0.5, 1, 0],
      ["cross-lingual", 2, 0.5, 1, 0],
      ["exact-identifier", 1, 0, 0, 0],
    ]);
  });

  it("an extra group no query matches is left out", () => {
    const groups = compareReports(a, b, { none: () => false }).map((r) => r.group);
    expect(groups).toEqual(["overall", "cross-lingual", "exact-identifier"]);
  });

  it("without extra groups the rows are unchanged", () => {
    expect(compareReports(a, b).map((r) => r.group)).toEqual(["overall", "cross-lingual", "exact-identifier"]);
  });
});

describe("formatPaired", () => {
  const r: CompareRow = {
    mode: "hybrid",
    group: "ru-involved",
    n: 8,
    meanA: 0.5,
    meanB: 0.625,
    delta: 0.125,
    ci: [0, 0.25],
    p: 0.125,
    hit1Wins: 1,
    hit1Losses: 0,
    signP: 1,
    mde: 0.3541,
    underpowered: true,
    headroom: 0.5,
  };

  it("one line: n, Δ, CI, perm p, flips, sign p, MDE, verdict", () => {
    expect(formatPaired(r)).toBe(
      "ru-involved paired n=8 Δ +0.125 95% CI [+0.000, +0.250] perm p 0.1250 flips 1/0 sign p 1.0000 MDE 0.354 UNDERPOWERED",
    );
  });

  it("a significant row carries no UNDERPOWERED flag", () => {
    expect(formatPaired({ ...r, p: 0.01, underpowered: false })).toBe(
      "ru-involved paired n=8 Δ +0.125 95% CI [+0.000, +0.250] perm p 0.0100 flips 1/0 sign p 1.0000 MDE 0.354",
    );
  });
});

describe("rrf-sweep checks carry paired stats", () => {
  const t: SweepThresholds = {
    candidates: [1.0, 1.5],
    baselineWeight: 1.0,
    ruUp: {
      liveOn: { ruInvolvedNdcg10MinDelta: 0, crossLingualNdcg10MinDelta: 0 },
      fixtureOff: { ruInvolvedNdcg10MinDelta: 0, crossLingualNdcg10MinDelta: 0 },
      fixtureOn: { ruInvolvedNdcg10MinDelta: 0, crossLingualNdcg10MinDelta: 0 },
    },
    enNonRegression: {
      kinds: ["exact-identifier"],
      liveOn: { maxNdcg10Drop: 0.01, maxBrokenHit1Queries: 0 },
      fixtureOff: { maxNdcg10Drop: 0.01, maxBrokenHit1Queries: 0 },
      fixtureOn: { maxNdcg10Drop: 0.01, maxBrokenHit1Queries: 0 },
    },
    zeroBroken: { modes: ["hybrid"] },
  };
  const agg = (ndcg10: number) => ({ hybrid: { n: 1, hit1: ndcg10, recall5: 1, mrr: ndcg10, ndcg10 } });
  const side = (r1: number): EvalReport =>
    report(
      [row("r1", "cross-lingual", r1, true), row("r2", "cross-lingual", 0, true), row("e1", "exact-identifier", 1)],
      {
        ruInvolved: agg(r1 / 2),
        byKind: { "cross-lingual": agg(r1 / 2), "exact-identifier": agg(1) },
      },
    );
  const triple = (r1: number): WeightReports => ({ fixtureOn: side(r1), fixtureOff: side(r1), liveOn: side(r1) });
  const v = scoreWeight(1.5, triple(0), triple(1), t, { pass: true, detail: "PASS" });

  it("the RU-up check pairs the RU-involved and cross-lingual queries", () => {
    const c = v.checks.find((x) => x.name === "fixtureOff RU-up")!;
    expect(c.paired!.map((r) => [r.group, r.n, r.delta, r.underpowered])).toEqual([
      ["ru-involved", 2, 0.5, true],
      ["cross-lingual", 2, 0.5, true],
    ]);
  });

  it("each EN check pairs its own kind", () => {
    const c = v.checks.find((x) => x.name === "liveOn EN exact-identifier")!;
    expect(c.paired!.map((r) => [r.group, r.n, r.delta])).toEqual([["exact-identifier", 1, 0]]);
  });

  it("the verdict keeps the full hybrid compare table per measurement", () => {
    expect(v.stats.fixtureOn.map((r) => r.group)).toEqual([
      "overall",
      "ru-involved",
      "cross-lingual",
      "exact-identifier",
    ]);
  });

  it("gate verdicts are unchanged by the stats", () => {
    expect([v.ruPass, v.enPass, v.pass]).toEqual([true, true, true]);
  });
});

describe("rerank-floor: sign test vs the current floor", () => {
  const t: FloorThresholds = {
    candidates: [0.3, 0.1, 0.01],
    currentFloor: 0.3,
    population: { fixture: { modes: ["hybrid"] }, live: { modes: ["hybrid"] } },
    negativeSeparation: { kinds: ["negative"], marginFactor: 0.5 },
  };
  const fr = (id: string, maxRerank: number): PerQueryRow => ({
    ...row(id, "semantic-paraphrase", 1),
    reranked: true,
    maxScore: 0.85,
    maxRerank,
  });
  // p1..p4 are false-flagged at 0.3; only 0.01 un-flags all four; p5 is never flagged
  const rows = [fr("p1", 0.05), fr("p2", 0.05), fr("p3", 0.02), fr("p4", 0.02), fr("p5", 0.5)];
  const res = scoreFloors(t, report(rows), report(rows));

  it("counts rows each floor un-flags / newly flags vs the current floor, with an exact sign p", () => {
    expect(res.verdicts.map((v) => [v.floor, v.vsCurrent])).toEqual([
      [0.3, { unflagged: 0, newlyFlagged: 0, signP: 1 }],
      [0.1, { unflagged: 0, newlyFlagged: 0, signP: 1 }],
      [0.01, { unflagged: 4, newlyFlagged: 0, signP: 0.125 }],
    ]);
  });

  it("the live population gets the same comparison", () => {
    expect(res.verdicts.find((v) => v.floor === 0.01)!.live!.vsCurrent).toEqual({
      unflagged: 4,
      newlyFlagged: 0,
      signP: 0.125,
    });
  });

  it("selection is unchanged (rate-based rule)", () => {
    expect([res.selected, res.adopted]).toEqual([0.01, true]);
  });
});
