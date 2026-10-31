// Unit tests for the mechanical eval gate (#85 item 8): synthetic reports, real thresholds
// semantics — non-regression vs baseline, figure-caption floors, inactive figure-negative.

import { describe, expect, it } from "vitest";
import { evaluateGate, type Thresholds } from "./gate.js";
import type { EvalReport, Mode, PerQueryRow, QueryKind } from "./harness.js";

const thresholds: Thresholds = {
  baselineReport: "unused-in-tests.json",
  nonRegression: {
    hybrid: { maxBrokenHit1Queries: 0, negativesFlagged: 2 },
    vector: { maxBrokenHit1Queries: 0, negativesFlagged: 2 },
    keyword: { maxBrokenHit1Queries: 1 },
  },
  figureCaption: {
    queryCount: { min: 2, max: 3 },
    gatedModes: ["hybrid"],
    hybrid: { hit1Min: 0.5, ndcg10Min: 0.5 },
    measuredUngatedModes: ["keyword"],
  },
  figureNegative: { active: false, queryCount: { min: 1, max: 2 }, flaggedRate: 1.0, positivesZeroedByFloor: 0 },
};

function row(id: string, mode: Mode, kind: QueryKind, over: Partial<PerQueryRow> = {}): PerQueryRow {
  const metricful = kind !== "negative" && kind !== "figure-negative";
  return {
    id,
    kind,
    scope: "library",
    mode,
    ru: false,
    retrieved: ["book-1"],
    ...(metricful ? { metrics: { hit1: 1, recall5: 1, rr: 1, ndcg10: 1 } } : { flagged: true }),
    ...over,
  };
}

/** Minimal report: evaluateGate only reads perQuery + meta.modes. */
function report(perQuery: PerQueryRow[]): EvalReport {
  return {
    meta: { modes: ["hybrid", "vector", "keyword"] } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery,
  };
}

/** A healthy current run: everything hit, negatives flagged, figure kinds present. */
function healthyRows(): PerQueryRow[] {
  const rows: PerQueryRow[] = [];
  for (const mode of ["hybrid", "vector", "keyword"] as Mode[]) {
    rows.push(row("sp-01", mode, "semantic-paraphrase"));
    rows.push(row("id-01", mode, "exact-identifier"));
    rows.push(row("neg-01", mode, "negative"));
    rows.push(row("neg-02", mode, "negative"));
    rows.push(row("fig-01", mode, "figure-caption", { target: "figures" }));
    rows.push(row("fig-02", mode, "figure-caption", { target: "figures" }));
    rows.push(row("fig-xl-01", mode, "figure-caption", { target: "figures", diagnostic: true }));
    rows.push(row("figneg-01", mode, "figure-negative", { target: "figures" }));
  }
  return rows;
}

const baseline = report(
  healthyRows().filter((r) => !r.kind.startsWith("figure")), // baseline predates figure kinds
);

describe("evaluateGate", () => {
  it("passes a healthy run and lists no drops", () => {
    const res = evaluateGate(report(healthyRows()), baseline, thresholds);
    expect(res.pass).toBe(true);
    expect(res.drops).toHaveLength(0);
  });

  it("fails hybrid on a single broken baseline query, and reports the drop", () => {
    const rows = healthyRows().map((r) =>
      r.id === "sp-01" && r.mode === "hybrid" ? { ...r, metrics: { hit1: 0, recall5: 0, rr: 0, ndcg10: 0 } } : r,
    );
    const res = evaluateGate(report(rows), baseline, thresholds);
    expect(res.pass).toBe(false);
    expect(res.drops.some((d) => d.includes("hybrid/sp-01"))).toBe(true);
  });

  it("keyword tolerates one broken query (declared tolerance) but not two", () => {
    const breakKw = (ids: string[]) =>
      healthyRows().map((r) =>
        ids.includes(r.id) && r.mode === "keyword" ? { ...r, metrics: { hit1: 0, recall5: 0, rr: 0, ndcg10: 0 } } : r,
      );
    expect(evaluateGate(report(breakKw(["sp-01"])), baseline, thresholds).pass).toBe(true);
    expect(evaluateGate(report(breakKw(["sp-01", "id-01"])), baseline, thresholds).pass).toBe(false);
  });

  it("a query missing from the current run counts as broken, never a silent pass", () => {
    const rows = healthyRows().filter((r) => !(r.id === "id-01" && r.mode === "vector"));
    const res = evaluateGate(report(rows), baseline, thresholds);
    expect(res.pass).toBe(false);
    expect(res.drops.some((d) => d.includes("vector/id-01") && d.includes("MISSING"))).toBe(true);
  });

  it("gates figure-caption on hybrid floors, excluding diagnostics", () => {
    // Diagnostic fails hard, gated queries pass → gate must still pass.
    const rows = healthyRows().map((r) =>
      r.id === "fig-xl-01" ? { ...r, metrics: { hit1: 0, recall5: 0, rr: 0, ndcg10: 0 } } : r,
    );
    expect(evaluateGate(report(rows), baseline, thresholds).pass).toBe(true);
    // Both gated hybrid queries fail → below hit1Min 0.5 → gate fails.
    const bad = healthyRows().map((r) =>
      r.kind === "figure-caption" && !r.diagnostic && r.mode === "hybrid"
        ? { ...r, metrics: { hit1: 0, recall5: 0, rr: 0, ndcg10: 0 } }
        : r,
    );
    expect(evaluateGate(report(bad), baseline, thresholds).pass).toBe(false);
  });

  it("figure-negative flagged rate is measured but inactive until the floor is calibrated", () => {
    const rows = healthyRows().map((r) => (r.kind === "figure-negative" ? { ...r, flagged: false } : r));
    const res = evaluateGate(report(rows), baseline, thresholds);
    expect(res.pass).toBe(true); // inactive check can't fail the gate…
    const check = res.checks.find((c) => c.name.startsWith("figure-negative: flagged rate"));
    expect(check?.active).toBe(false); // …but it is still measured and printed
    expect(check?.pass).toBe(false);
    // flipping active arms it
    const armed = { ...thresholds, figureNegative: { ...thresholds.figureNegative, active: true } };
    expect(evaluateGate(report(rows), baseline, armed).pass).toBe(false);
  });

  it("gates the heading front-matter trap per mode; a missing query is a miss", () => {
    const withHfm: Thresholds = {
      ...thresholds,
      headingFrontMatter: { queryIds: ["fmt-04", "fmt-05"], minHit1Queries: { keyword: 1, hybrid: 2 } },
    };
    const rows = [
      ...healthyRows(),
      ...(["hybrid", "vector", "keyword"] as Mode[]).flatMap((m) => [
        row("fmt-04", m, "front-matter-trap", { scope: "book" }),
        row("fmt-05", m, "front-matter-trap", { scope: "book" }),
      ]),
    ];
    expect(evaluateGate(report(rows), baseline, withHfm).pass).toBe(true);
    // keyword tolerates one miss (min 1 of 2)…
    const kwMiss = rows.map((r) =>
      r.id === "fmt-05" && r.mode === "keyword" ? { ...r, metrics: { hit1: 0, recall5: 1, rr: 0.5, ndcg10: 0.6 } } : r,
    );
    expect(evaluateGate(report(kwMiss), baseline, withHfm).pass).toBe(true);
    // …hybrid does not, and a dropped row counts as a miss
    const hyMissing = rows.filter((r) => !(r.id === "fmt-04" && r.mode === "hybrid"));
    const res = evaluateGate(report(hyMissing), baseline, withHfm);
    expect(res.pass).toBe(false);
    expect(res.checks.find((c) => c.name === "heading front-matter hybrid: Hit@1 queries")?.detail).toContain(
      "missed: fmt-04",
    );
  });

  it("enforces the declared figure query counts", () => {
    const rows = healthyRows().filter((r) => r.id !== "fig-02"); // 1 gated < min 2
    expect(evaluateGate(report(rows), baseline, thresholds).pass).toBe(false);
  });
});

// Score drift (#325, from #317/#322/#323): non-regression only sees Hit@1 flips, so small
// ranking/score shifts vs the frozen baseline pass unseen. These pin the drift check.
describe("evaluateGate score drift (#325)", () => {
  const drift = { metricEpsilon: 0.005, maxScoreEpsilon: 0.01, maxScoreModes: ["hybrid", "vector"] as Mode[] };
  const withDrift: Thresholds = { ...thresholds, scoreDrift: drift };
  const agg = (ndcg10: number) => ({ n: 2, hit1: 1, recall5: 1, mrr: 1, ndcg10 });

  /** A report with aggregates and per-query maxScore set; `edit` tweaks one copy. */
  function scored(ndcgHybrid: number, sp01Hybrid = 0.84, sp01Keyword = -7.5): EvalReport {
    const rows = healthyRows()
      .filter((r) => !r.kind.startsWith("figure"))
      .map((r) =>
        r.id === "sp-01"
          ? { ...r, maxScore: r.mode === "hybrid" ? sp01Hybrid : r.mode === "keyword" ? sp01Keyword : 0.84 }
          : r,
      );
    return {
      ...report(rows),
      overall: { hybrid: agg(ndcgHybrid), vector: agg(0.97), keyword: agg(0.818) },
      ruInvolved: { hybrid: agg(0.9824), vector: agg(0.9824), keyword: agg(0.5238) },
    };
  }
  const base = scored(0.9705);
  const withFigures = (r: EvalReport): EvalReport => ({
    ...r,
    perQuery: [...r.perQuery, ...healthyRows().filter((x) => x.kind.startsWith("figure"))],
  });
  const check = (res: ReturnType<typeof evaluateGate>, name: string) => res.checks.find((c) => c.name === name);

  it("passes when the run reproduces the baseline scores", () => {
    const res = evaluateGate(withFigures(scored(0.9705)), base, withDrift);
    expect(check(res, "score drift: aggregate metrics")).toMatchObject({ active: true, pass: true });
    expect(check(res, "score drift: per-query maxScore")).toMatchObject({ active: true, pass: true });
    expect(res.pass).toBe(true);
  });

  it("tolerates aggregate drift within the epsilon", () => {
    const res = evaluateGate(withFigures(scored(0.9665)), base, withDrift); // |Δ| = 0.004
    expect(check(res, "score drift: aggregate metrics")?.pass).toBe(true);
  });

  it("fails on aggregate drift beyond the epsilon and names the metric", () => {
    const res = evaluateGate(withFigures(scored(0.9645)), base, withDrift); // |Δ| = 0.006
    expect(res.pass).toBe(false);
    expect(check(res, "score drift: aggregate metrics")?.detail).toBe(
      "1 beyond ±0.005: overall hybrid ndcg10 0.9705 → 0.9645",
    );
  });

  it("fails when a baseline aggregate is missing from the run", () => {
    const cur = withFigures(scored(0.9705));
    const { keyword: _dropped, ...overall } = cur.overall;
    const res = evaluateGate({ ...cur, overall }, base, withDrift);
    expect(check(res, "score drift: aggregate metrics")?.detail).toContain("overall keyword MISSING");
    expect(res.pass).toBe(false);
  });

  it("fails on a per-query maxScore shift beyond the epsilon in a gated mode only", () => {
    const res = evaluateGate(withFigures(scored(0.9705, 0.82)), base, withDrift); // hybrid Δ 0.02
    expect(res.pass).toBe(false);
    expect(check(res, "score drift: per-query maxScore")?.detail).toBe(
      "1 beyond ±0.01; worst hybrid/sp-01 0.8400 → 0.8200",
    );
    // keyword bm25 scores are not in maxScoreModes: a large shift there is ignored
    const kw = evaluateGate(withFigures(scored(0.9705, 0.84, -3)), base, withDrift);
    expect(check(kw, "score drift: per-query maxScore")?.pass).toBe(true);
  });

  it("fails when no baseline maxScore row is matched (an empty compare is not a pass)", () => {
    const cur = withFigures(scored(0.9705));
    const noScores = { ...cur, perQuery: cur.perQuery.map(({ maxScore: _m, ...r }) => r) };
    const res = evaluateGate(noScores, base, withDrift);
    expect(check(res, "score drift: per-query maxScore")).toMatchObject({
      pass: false,
      detail: "only 0/2 baseline rows matched; missing: hybrid/sp-01, vector/sp-01",
    });
    expect(res.pass).toBe(false);
  });

  it("fails when fewer rows match than the baseline has, naming the missing ones", () => {
    const cur = withFigures(scored(0.9705));
    const partial = {
      ...cur,
      perQuery: cur.perQuery.map((r) => (r.id === "sp-01" && r.mode === "vector" ? { ...r, maxScore: undefined } : r)),
    };
    const res = evaluateGate(partial, base, withDrift);
    expect(check(res, "score drift: per-query maxScore")).toMatchObject({
      pass: false,
      detail: "only 1/2 baseline rows matched; missing: vector/sp-01",
    });
  });

  it("adds no drift checks when thresholds declare none", () => {
    const res = evaluateGate(withFigures(scored(0.9)), base, thresholds);
    expect(res.checks.filter((c) => c.name.startsWith("score drift"))).toEqual([]);
  });
});
