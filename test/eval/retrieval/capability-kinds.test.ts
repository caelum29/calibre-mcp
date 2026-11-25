// Capability kinds (#359): the four hard fixture kinds measure headroom, not regressions. Their
// Hit@1 drops are listed as report-only in every tier (rerank on, fusion-only, hash) until a later
// rule commit promotes a kind by removing it from `capabilityKinds`; any other drop still fails.

import { describe, expect, it } from "vitest";
import { evaluateFusionOnlyGate, evaluateGate, type GateResult, type Thresholds } from "./gate.js";
import type { EvalReport, Mode, PerQueryRow, QueryKind } from "./harness.js";
import { evaluateHashGate, toRankBaseline } from "./hash-gate.js";

const MODES: Mode[] = ["hybrid", "vector", "keyword"];
const CAP: QueryKind[] = ["confuser-pair", "no-overlap-paraphrase", "adjacent-negative", "raw-title"];

function row(id: string, kind: QueryKind, mode: Mode, hit1: 0 | 1): PerQueryRow {
  const negative = kind === "negative" || kind === "adjacent-negative";
  return {
    id,
    kind,
    scope: "library",
    mode,
    ru: false,
    retrieved: hit1 ? ["101", "102"] : ["102", "101"],
    ...(negative
      ? { flagged: hit1 === 1 }
      : { metrics: { hit1, recall5: 1, rr: hit1 ? 1 : 0.5, ndcg10: hit1 ? 1 : 0.6 } }),
  };
}

/** Every mode solves sp-01, cp-01 and no-01; neg-01 is flagged. `breaks` = "mode/id" rows that miss. */
function report(breaks: string[] = [], rerank = "off"): EvalReport {
  const perQuery = MODES.flatMap((m) =>
    (
      [
        ["sp-01", "semantic-paraphrase"],
        ["cp-01", "confuser-pair"],
        ["no-01", "no-overlap-paraphrase"],
        ["neg-01", "negative"],
      ] as [string, QueryKind][]
    ).map(([id, k]) => row(id, k, m, breaks.includes(`${m}/${id}`) ? 0 : 1)),
  );
  return {
    meta: { modes: MODES, rerank, rerankedRows: 0 } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery,
  };
}

const t: Thresholds = {
  baselineReport: "unused.json",
  nonRegression: {
    hybrid: { maxBrokenHit1Queries: 0, negativesFlagged: 1 },
    vector: { maxBrokenHit1Queries: 0 },
    keyword: { maxBrokenHit1Queries: 0 },
  },
  capabilityKinds: { kinds: CAP },
};
const fusionCfg: NonNullable<Thresholds["fusionOnly"]> = {
  rerank: "off",
  nonRegression: { hybrid: { maxBrokenHit1Queries: 0 }, vector: { maxBrokenHit1Queries: 0 } },
  reportOnlyKinds: ["cross-lingual"],
};
const hashRule: NonNullable<Thresholds["hashGate"]> = {
  nonRegression: { hybrid: { maxBrokenHit1Queries: 0 }, keyword: { maxBrokenHit1Queries: 0 } },
  maxDurationMs: 1,
};

const lines = (r: GateResult) =>
  r.checks.map((c) => `${c.active ? (c.pass ? "PASS" : "FAIL") : "info"} ${c.name} — ${c.detail}`);

describe("capabilityKinds: rerank-on tier (evaluateGate)", () => {
  it("a capability-kind drop is listed but does not fail", () => {
    const res = evaluateGate(report(["hybrid/cp-01", "hybrid/no-01"]), report(), t);
    expect(res.pass).toBe(true);
    expect(lines(res)).toContain("PASS non-regression hybrid: broken Hit@1 queries — 0 broken (allowed 0)");
    expect(lines(res)).toContain("info non-regression hybrid: capability kinds (report-only) — 2 broken: cp-01, no-01");
    expect(res.drops).toEqual([
      "hybrid/cp-01 (confuser-pair) [capability]: baseline Hit@1=1 → now Hit@1=0 top3=[102, 101]",
      "hybrid/no-01 (no-overlap-paraphrase) [capability]: baseline Hit@1=1 → now Hit@1=0 top3=[102, 101]",
    ]);
  });

  it("a semantic-paraphrase drop still fails", () => {
    const res = evaluateGate(report(["hybrid/sp-01"]), report(), t);
    expect(res.pass).toBe(false);
    expect(lines(res)).toContain("FAIL non-regression hybrid: broken Hit@1 queries — 1 broken (allowed 0): sp-01");
  });

  it("an unflagged `negative` still fails negativesFlagged", () => {
    const res = evaluateGate(report(["hybrid/neg-01"]), report(), t);
    expect(res.pass).toBe(false);
    expect(lines(res)).toContain("FAIL non-regression hybrid: negatives flagged — 0/1 flagged (need 1)");
  });

  it("without the block, the same capability drop fails (promotion = remove the kind)", () => {
    const { capabilityKinds: _, ...promoted } = t;
    expect(evaluateGate(report(["hybrid/cp-01"]), report(), promoted).pass).toBe(false);
  });
});

describe("capabilityKinds: fusion-only tier", () => {
  it("a capability-kind drop is listed but does not fail; a semantic-paraphrase drop does", () => {
    const ok = evaluateFusionOnlyGate(report(["vector/cp-01"]), report(), fusionCfg, [], CAP);
    expect(ok.pass).toBe(true);
    expect(lines(ok)).toContain("info fusion-only vector: capability kinds (report-only) — 1 broken: cp-01");
    expect(lines(ok)).toContain("PASS fusion-only vector: broken Hit@1 queries — 0 broken (allowed 0)");
    expect(evaluateFusionOnlyGate(report(["vector/sp-01"]), report(), fusionCfg, [], CAP).pass).toBe(false);
  });
});

describe("capabilityKinds: hash tier", () => {
  it("a capability-kind drop is listed but does not fail; a semantic-paraphrase drop does", () => {
    const base = toRankBaseline(report());
    const ok = evaluateHashGate(report(["keyword/no-01"]), base, hashRule, CAP);
    expect(ok.pass).toBe(true);
    expect(lines(ok)).toContain("info non-regression keyword: capability kinds (report-only) — 1 broken: no-01");
    expect(evaluateHashGate(report(["keyword/sp-01"]), base, hashRule, CAP).pass).toBe(false);
  });
});
