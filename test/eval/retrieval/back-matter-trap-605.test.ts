// #605 gate rule, declared before the freezing run (D-012): per listed mode, every
// back-matter-trap query retrieves its relevant passage with no front/back-matter passage ranked
// above it (`nonBodyAbove === 0`); a missing row or a missing relevant passage fails.

import { describe, expect, it } from "vitest";
import { evaluateGate, type Thresholds } from "./gate.js";
import { type EvalReport, type GoldenQuery, type Mode, type PerQueryRow, type QueryOutcome, toRow } from "./harness.js";

const MODES: Mode[] = ["hybrid", "vector", "keyword"];

const base: Thresholds = {
  baselineReport: "unused-in-tests.json",
  nonRegression: {},
  backMatterTrap: { queryIds: ["bmt-01", "bmt-02"], modes: MODES },
};

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
    meta: { modes: MODES } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery,
  };
}

const healthy = () => MODES.flatMap((m) => [row("bmt-01", m, 0), row("bmt-02", m, 0)]);
const check = (res: ReturnType<typeof evaluateGate>, mode: Mode) =>
  res.checks.find((c) => c.name === `back-matter trap ${mode}: no front/back matter above the relevant passage`)!;

describe("back-matter-trap gate (#605)", () => {
  it("passes when no front/back-matter passage ranks above the relevant one in any mode", () => {
    const res = evaluateGate(report(healthy()), report([]), base);
    expect([res.pass, MODES.map((m) => check(res, m).detail)]).toEqual([true, ["2/2", "2/2", "2/2"]]);
  });

  it("fails the mode where a back-matter passage outranks the relevant one", () => {
    const rows = healthy().map((r) => (r.id === "bmt-02" && r.mode === "keyword" ? row("bmt-02", "keyword", 1) : r));
    const res = evaluateGate(report(rows), report([]), base);
    expect([res.pass, check(res, "keyword").detail, check(res, "hybrid").pass]).toEqual([
      false,
      "1/2; failed: bmt-02",
      true,
    ]);
  });

  it("fails when the relevant passage is not retrieved (no nonBodyAbove) or the row is missing", () => {
    const rows = healthy()
      .filter((r) => !(r.id === "bmt-01" && r.mode === "vector"))
      .map((r) => (r.id === "bmt-02" && r.mode === "hybrid" ? row("bmt-02", "hybrid", undefined) : r));
    const res = evaluateGate(report(rows), report([]), base);
    expect([check(res, "vector").detail, check(res, "hybrid").detail]).toEqual([
      "1/2; failed: bmt-01",
      "1/2; failed: bmt-02",
    ]);
  });
});

describe("toRow carries nonBodyAbove only on back-matter-trap rows (#605)", () => {
  const out: QueryOutcome = {
    rel: { matches: [[], ["span"]], relevantCount: 1 },
    retrieved: ["@0-10", "@10-20"],
    count: 2,
    nonBodyAbove: 1,
  };
  const q = (kind: GoldenQuery["kind"]): GoldenQuery =>
    ({ id: "x", kind, scope: "book", bookId: 1, query: "q", relevant: [] }) as unknown as GoldenQuery;

  it("sets it for back-matter-trap and leaves every other kind's row unchanged", () => {
    expect([
      toRow(q("back-matter-trap"), "hybrid", out).nonBodyAbove,
      "nonBodyAbove" in toRow(q("front-matter-trap"), "hybrid", out),
    ]).toEqual([1, false]);
  });
});
