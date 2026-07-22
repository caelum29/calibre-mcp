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

function row(
  id: string,
  mode: Mode,
  kind: QueryKind,
  over: Partial<PerQueryRow> = {},
): PerQueryRow {
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
      r.id === "sp-01" && r.mode === "hybrid"
        ? { ...r, metrics: { hit1: 0, recall5: 0, rr: 0, ndcg10: 0 } }
        : r,
    );
    const res = evaluateGate(report(rows), baseline, thresholds);
    expect(res.pass).toBe(false);
    expect(res.drops.some((d) => d.includes("hybrid/sp-01"))).toBe(true);
  });

  it("keyword tolerates one broken query (declared tolerance) but not two", () => {
    const breakKw = (ids: string[]) =>
      healthyRows().map((r) =>
        ids.includes(r.id) && r.mode === "keyword"
          ? { ...r, metrics: { hit1: 0, recall5: 0, rr: 0, ndcg10: 0 } }
          : r,
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
    const rows = healthyRows().map((r) =>
      r.kind === "figure-negative" ? { ...r, flagged: false } : r,
    );
    const res = evaluateGate(report(rows), baseline, thresholds);
    expect(res.pass).toBe(true); // inactive check can't fail the gate…
    const check = res.checks.find((c) => c.name.startsWith("figure-negative: flagged rate"));
    expect(check?.active).toBe(false); // …but it is still measured and printed
    expect(check?.pass).toBe(false);
    // flipping active arms it
    const armed = { ...thresholds, figureNegative: { ...thresholds.figureNegative, active: true } };
    expect(evaluateGate(report(rows), baseline, armed).pass).toBe(false);
  });

  it("enforces the declared figure query counts", () => {
    const rows = healthyRows().filter((r) => r.id !== "fig-02"); // 1 gated < min 2
    expect(evaluateGate(report(rows), baseline, thresholds).pass).toBe(false);
  });
});
