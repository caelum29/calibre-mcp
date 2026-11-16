// The frozen held-out query set (#632): 20 fixture queries tuning scorers never read, reported
// apart. The ids were drawn once by folds.ts `stratifiedSample` (seed 0x358, stratified by kind,
// over the 66 non-diagnostic queries) and are pinned here: never re-drawn, never edited.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EvalReport, Mode, PerQueryRow, QueryKind } from "./harness.js";
import { heldOutIds, type GoldenQuery } from "./harness.js";
import { scoreFloors, type FloorThresholds } from "./rerank-floor.js";
import { scoreWeight, type SweepThresholds, type WeightReports } from "./rrf-sweep.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const queries = JSON.parse(readFileSync(path.join(HERE, "queries.json"), "utf8")) as GoldenQuery[];

const FROZEN = [
  "fig-02",
  "fig-05",
  "figneg-01",
  "fmt-02",
  "fmt-06",
  "id-02",
  "id-06",
  "id-10",
  "idb-01",
  "neg-03",
  "neg-05",
  "ru-03",
  "ru-06",
  "sp-08",
  "sp-11",
  "sp-12",
  "sp-13",
  "spb-02",
  "xl-06",
  "xl-07",
];

// #359's hard kinds, drawn the same way over its 28 queries (8, 2 per kind) and frozen too.
const FROZEN_359 = ["an-02", "an-04", "cp-03", "cp-04", "nop-07", "nop-08", "rt-02", "rt-05"];

describe("held-out set (#632)", () => {
  it("is exactly the frozen ids: 20 from #632 plus 8 from #359", () => {
    expect([...heldOutIds()].sort()).toEqual([...FROZEN, ...FROZEN_359].sort());
  });

  it("has the declared per-kind counts", () => {
    const held = queries.filter((q) => q.heldOut === true);
    const counts: Record<string, number> = {};
    for (const q of held) counts[q.kind] = (counts[q.kind] ?? 0) + 1;
    expect(counts).toEqual({
      "semantic-paraphrase": 5,
      "exact-identifier": 4,
      "figure-caption": 2,
      "cross-lingual": 2,
      "ru-monolingual": 2,
      "front-matter-trap": 2,
      negative: 2,
      "figure-negative": 1,
      "confuser-pair": 2,
      "no-overlap-paraphrase": 2,
      "adjacent-negative": 2,
      "raw-title": 2,
    });
  });

  it("holds out no diagnostic query", () => {
    expect(queries.filter((q) => q.diagnostic === true && q.heldOut === true).map((q) => q.id)).toEqual([]);
  });

  it("uses only `true` as the flag value", () => {
    expect(queries.filter((q) => "heldOut" in q && q.heldOut !== true).map((q) => q.id)).toEqual([]);
  });
});

// Guard (#632): a tuning scorer must give exactly the result it gives with the held-out rows
// deleted. Each case below plants a held-out row that would decide the outcome if it were read.
// Adding a tuning scorer? Add its case here.

/** Precomputed aggregates over ALL rows, as the harness writes them (so trusting them leaks). */
function sweepReport(rows: PerQueryRow[]): EvalReport {
  const agg = (rs: PerQueryRow[]) => {
    const m = (f: (r: PerQueryRow) => number) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
    return {
      hybrid: {
        n: rs.length,
        hit1: m((r) => r.metrics!.hit1),
        recall5: 1,
        mrr: m((r) => r.metrics!.rr),
        ndcg10: m((r) => r.metrics!.ndcg10),
      },
    };
  };
  const byKind: EvalReport["byKind"] = {};
  for (const k of new Set(rows.map((r) => r.kind))) byKind[k] = agg(rows.filter((r) => r.kind === k));
  return {
    meta: { modes: ["hybrid"] as Mode[] } as EvalReport["meta"],
    overall: agg(rows),
    ruInvolved: agg(rows.filter((r) => r.ru)),
    byKind,
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
  };
}

function sweepRow(id: string, kind: QueryKind, ndcg10: number, ru = true): PerQueryRow {
  return {
    id,
    kind,
    scope: "library",
    mode: "hybrid",
    ru,
    retrieved: [],
    metrics: { hit1: ndcg10 >= 1 ? 1 : 0, recall5: 1, rr: ndcg10, ndcg10 },
  };
}

const sweepT: SweepThresholds = {
  candidates: [1.0, 1.5],
  baselineWeight: 1.0,
  ruUp: {
    liveOn: { ruInvolvedNdcg10MinDelta: 0.01, crossLingualNdcg10MinDelta: 0.01 },
    fixtureOff: { ruInvolvedNdcg10MinDelta: 0.02, crossLingualNdcg10MinDelta: 0.02 },
    fixtureOn: { ruInvolvedNdcg10MinDelta: 0, crossLingualNdcg10MinDelta: 0 },
  },
  enNonRegression: {
    kinds: ["exact-identifier"],
    liveOn: { maxNdcg10Drop: 0.02, maxBrokenHit1Queries: 0 },
    fixtureOff: { maxNdcg10Drop: 0.01, maxBrokenHit1Queries: 0 },
    fixtureOn: { maxNdcg10Drop: 0.01, maxBrokenHit1Queries: 0 },
  },
  zeroBroken: { modes: ["hybrid"] },
};

describe("rrf-sweep scoreWeight skips held-out queries (#632)", () => {
  // xl-06 is held out; at the candidate weight it alone lifts cross-lingual nDCG from 0.5 to 1.0
  const rows = (xl06: number): PerQueryRow[] => [
    sweepRow("xl-01", "cross-lingual", 0.5),
    sweepRow("xl-06", "cross-lingual", xl06),
    sweepRow("id-01", "exact-identifier", 1, false),
  ];
  const triple = (rs: PerQueryRow[]): WeightReports => ({
    fixtureOn: sweepReport(rs),
    fixtureOff: sweepReport(rs),
    liveOn: sweepReport(rs),
  });
  const drop = (rs: PerQueryRow[]) => rs.filter((r) => r.id !== "xl-06");
  const green = { pass: true, detail: "PASS" };

  it("gives exactly the result of the same reports with the held-out row deleted", () => {
    const withHeld = scoreWeight(1.5, triple(rows(0.5)), triple(rows(1)), sweepT, green);
    const without = scoreWeight(1.5, triple(drop(rows(0.5))), triple(drop(rows(1))), sweepT, green);
    expect(withHeld).toEqual(without);
    // the held-out lift would have passed RU-up; without it nothing moved
    expect(withHeld.ruPass).toBe(false);
    expect(withHeld.numbers.liveOn.xl).toBe(0.5);
  });

  it("keeps the zero-broken gate result the caller computed on the full set", () => {
    const v = scoreWeight(1.5, triple(rows(0.5)), triple(rows(1)), sweepT, { pass: false, detail: "FAIL" });
    expect(v.zeroBrokenPass).toBe(false);
  });
});

const floorT: FloorThresholds = {
  candidates: [0.3, 0.1, 0.01],
  currentFloor: 0.3,
  population: { fixture: { modes: ["hybrid"] }, live: { modes: ["hybrid"] } },
  negativeSeparation: { kinds: ["negative", "figure-negative"], marginFactor: 0.5 },
};

function floorRow(id: string, kind: QueryKind, maxRerank: number): PerQueryRow {
  const metrics = kind === "negative" ? undefined : { hit1: 1, recall5: 1, rr: 1, ndcg10: 1 };
  return {
    id,
    kind,
    scope: "library",
    mode: "hybrid",
    ru: false,
    retrieved: [],
    reranked: true,
    maxScore: 0.85,
    maxRerank,
    ...(metrics ? { metrics } : {}),
  };
}

describe("rerank-floor scoreFloors skips held-out queries (#632)", () => {
  const base = [
    floorRow("sp-01", "semantic-paraphrase", 0.05),
    floorRow("id-01", "exact-identifier", 0.5),
    floorRow("neg-01", "negative", 0.004),
  ];
  // neg-03 is held out: its maxRerank 0.2 would fail separation for every candidate below 0.4
  const heldNeg = floorRow("neg-03", "negative", 0.2);
  // sp-08 is held out: a positive at 0.02 would be false-flagged by 0.1 and change the rates
  const heldPos = floorRow("sp-08", "semantic-paraphrase", 0.02);
  const rep = (rows: PerQueryRow[]) => ({ perQuery: rows }) as EvalReport;

  it("gives exactly the result of the same reports with the held-out rows deleted", () => {
    const withHeld = scoreFloors(floorT, rep([...base, heldNeg, heldPos]), rep([...base, heldNeg, heldPos]));
    const without = scoreFloors(floorT, rep(base), rep(base));
    expect(withHeld).toEqual(without);
    expect(withHeld.maxNegative).toBe(0.004);
    expect(withHeld.selected).toBe(0.01);
    expect(withHeld.verdicts[0]!.live!.negativesUnflagged).toEqual([]);
  });
});
