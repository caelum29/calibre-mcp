// #359 hard kinds in the harness and the report-only axes: an adjacent negative is scored like a
// negative (flagged = no results or lowConfidence), a confuser-pair row carries its confusers, and
// every run prints the confuser@1 rate and the adjacent-negative flagged rate per mode.

import { describe, expect, it } from "vitest";
import { computeAxes, renderAxes } from "./axes.js";
import type { Thresholds } from "./gate.js";
import { toRow, type EvalReport, type GoldenQuery, type PerQueryRow, type QueryOutcome } from "./harness.js";

const out = (over: Partial<QueryOutcome>): QueryOutcome => ({
  rel: { matches: [], relevantCount: 0 },
  retrieved: ["118", "101"],
  count: 2,
  ...over,
});
const q = (over: Partial<GoldenQuery>): GoldenQuery => ({
  id: "x",
  kind: "adjacent-negative",
  scope: "library",
  query: "q",
  relevant: [],
  ...over,
});

describe("toRow for the #359 kinds", () => {
  it("scores an adjacent negative like a negative: flagged, no metrics", () => {
    const low = toRow(q({}), "hybrid", out({ lowConfidence: true }));
    expect(low.flagged).toBe(true);
    expect(low.metrics).toBeUndefined();
    expect(toRow(q({}), "hybrid", out({ lowConfidence: false })).flagged).toBe(false);
    expect(toRow(q({}), "hybrid", out({ count: 0, retrieved: [] })).flagged).toBe(true);
  });

  it("copies a confuser-pair query's confusers onto the row", () => {
    const row = toRow(
      q({ kind: "confuser-pair", relevant: [101], confusers: [118] }),
      "hybrid",
      out({ rel: { matches: [[], ["101"]], relevantCount: 1 } }),
    );
    expect(row.confusers).toEqual([118]);
    expect(row.metrics?.hit1).toBe(0);
  });
});

function row(id: string, kind: PerQueryRow["kind"], over: Partial<PerQueryRow>): PerQueryRow {
  return { id, kind, scope: "library", mode: "hybrid", ru: false, retrieved: [], ...over };
}
const report = {
  meta: { modes: ["hybrid"] },
  perQuery: [
    row("cp-01", "confuser-pair", { retrieved: ["118", "101"], confusers: [118] }), // confuser at 1
    row("cp-02", "confuser-pair", { retrieved: ["101", "118"], confusers: [118] }),
    row("cp-03", "confuser-pair", { retrieved: [], confusers: [119] }), // empty list: no rank 1
    row("an-01", "adjacent-negative", { flagged: true }),
    row("an-02", "adjacent-negative", { flagged: false }),
    row("neg-01", "negative", { flagged: false }), // not counted with adjacent negatives
  ],
} as unknown as EvalReport;

describe("hard-kind axes", () => {
  it("computes confuser@1 and the adjacent-negative flagged rate per mode", () => {
    const a = computeAxes(report).hybrid!;
    expect(a.confuserAt1).toEqual({ n: 3, atRank1: 1 });
    expect(a.adjacentNegative).toEqual({ n: 2, flagged: 1 });
  });

  it("renders both axes when declared", () => {
    const cfg: NonNullable<Thresholds["reportOnlyAxes"]> = {
      confuserAt1: { gate: false, trend: "lower is better" },
      adjacentNegative: { gate: false, trend: "higher is better" },
    };
    expect(renderAxes(computeAxes(report), cfg)).toEqual([
      "report-only axes (#363, thresholds.reportOnlyAxes; never gated)",
      "  confuserAt1: trend: lower is better",
      "    hybrid: confuser at rank 1 1/3 (0.333)",
      "  adjacentNegative: trend: higher is better",
      "    hybrid: flagged 1/2 (0.500)",
    ]);
  });

  it("omits both axes for a mode without those kinds", () => {
    const plain = {
      meta: { modes: ["hybrid"] },
      perQuery: [row("sp-01", "semantic-paraphrase", {})],
    } as unknown as EvalReport;
    const a = computeAxes(plain).hybrid!;
    expect(a.confuserAt1).toBeUndefined();
    expect(a.adjacentNegative).toBeUndefined();
  });
});
