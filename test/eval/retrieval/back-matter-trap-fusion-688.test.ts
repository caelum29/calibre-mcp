// #688: the back-matter-trap rule (#605) holds in every mode of every tier, the fusion-only
// (rerank off) pass included: there the bodyFirst partition alone decides placement, which is
// also what a Desktop user gets when the reranker is unavailable.

import { describe, expect, it } from "vitest";
import { evaluateFusionOnlyGate, type Thresholds } from "./gate.js";
import type { EvalReport, Mode, PerQueryRow } from "./harness.js";

const MODES: Mode[] = ["hybrid", "vector", "keyword"];

const fusion: NonNullable<Thresholds["fusionOnly"]> = {
  rerank: "off",
  nonRegression: {},
  reportOnlyKinds: [],
};
const trap: NonNullable<Thresholds["backMatterTrap"]> = { queryIds: ["bmt-01", "bmt-02"], modes: MODES };

function row(id: string, mode: Mode, nonBodyAbove: number | undefined): PerQueryRow {
  return {
    id,
    kind: "back-matter-trap",
    scope: "book",
    mode,
    ru: false,
    retrieved: ["@0-10"],
    metrics: { hit1: 1, recall5: 1, rr: 1, ndcg10: 1 },
    ...(nonBodyAbove !== undefined ? { nonBodyAbove } : {}),
  };
}

function report(perQuery: PerQueryRow[]): EvalReport {
  return {
    meta: { modes: MODES, rerank: "off", rerankedRows: 0 } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery,
  };
}

const healthy = () => MODES.flatMap((m) => [row("bmt-01", m, 0), row("bmt-02", m, 0)]);
const check = (res: ReturnType<typeof evaluateFusionOnlyGate>, mode: Mode) =>
  res.checks.find(
    (c) => c.name === `fusion-only back-matter trap ${mode}: no front/back matter above the relevant passage`,
  );

describe("back-matter-trap gate in the fusion-only pass (#688)", () => {
  it("passes in every mode when no front/back-matter passage ranks above the relevant one", () => {
    const res = evaluateFusionOnlyGate(report(healthy()), report([]), fusion, [], [], trap);
    expect([res.pass, MODES.map((m) => check(res, m)?.detail)]).toEqual([true, ["2/2", "2/2", "2/2"]]);
  });

  it("fails the fusion-only gate when a back-matter chunk ranks above the relevant body passage", () => {
    const rows = healthy().map((r) => (r.id === "bmt-01" && r.mode === "hybrid" ? row("bmt-01", "hybrid", 1) : r));
    const res = evaluateFusionOnlyGate(report(rows), report([]), fusion, [], [], trap);
    expect([res.pass, check(res, "hybrid")?.detail, check(res, "vector")?.pass]).toEqual([
      false,
      "1/2; failed: bmt-01",
      true,
    ]);
  });

  it("fails when the relevant passage is missing from the fusion-only run", () => {
    const rows = healthy().filter((r) => !(r.id === "bmt-02" && r.mode === "keyword"));
    const res = evaluateFusionOnlyGate(report(rows), report([]), fusion, [], [], trap);
    expect([res.pass, check(res, "keyword")?.detail]).toEqual([false, "1/2; failed: bmt-02"]);
  });

  it("adds no back-matter check when thresholds declare no backMatterTrap block", () => {
    const res = evaluateFusionOnlyGate(report([]), report([]), fusion);
    expect(res.checks.filter((c) => c.name.includes("back-matter trap"))).toEqual([]);
  });
});
