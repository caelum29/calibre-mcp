// Unit tests for the fusion-only gate tier (#356): a --rerank off run vs the frozen OFF baseline.
// No baseline Hit@1=1 query may break in any mode; cross-lingual drops are report-only.

import { describe, expect, it } from "vitest";
import { evaluateFusionOnlyGate, type Thresholds } from "./gate.js";
import type { EvalReport, Mode, PerQueryRow, QueryKind } from "./harness.js";

const cfg: NonNullable<Thresholds["fusionOnly"]> = {
  baselineReport: "unused-in-tests.json",
  rerank: "off",
  nonRegression: {
    hybrid: { maxBrokenHit1Queries: 0 },
    vector: { maxBrokenHit1Queries: 0 },
    keyword: { maxBrokenHit1Queries: 0 },
  },
  reportOnlyKinds: ["cross-lingual"],
};

const MODES: Mode[] = ["hybrid", "vector", "keyword"];

function row(id: string, mode: Mode, kind: QueryKind, hit1: 0 | 1, retrieved = ["book-101"]): PerQueryRow {
  return {
    id,
    kind,
    scope: "library",
    mode,
    ru: false,
    retrieved,
    metrics: { hit1, recall5: hit1, rr: hit1, ndcg10: hit1 },
  };
}

function report(perQuery: PerQueryRow[], rerank = "off", rerankedRows = 0): EvalReport {
  return {
    meta: { modes: MODES, rerank, rerankedRows } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery,
  };
}

/** OFF baseline: sp-01 + xl-01 solved everywhere, id-01 missed everywhere. */
function baselineRows(): PerQueryRow[] {
  return MODES.flatMap((m) => [
    row("sp-01", m, "semantic-paraphrase", 1),
    row("xl-01", m, "cross-lingual", 1),
    row("id-01", m, "exact-identifier", 0),
  ]);
}

/** Replace one (id, mode) row of the baseline set. */
function withRow(replacement: PerQueryRow): PerQueryRow[] {
  return baselineRows().map((r) => (r.id === replacement.id && r.mode === replacement.mode ? replacement : r));
}

const checkNamed = (res: ReturnType<typeof evaluateFusionOnlyGate>, name: string) =>
  res.checks.find((c) => c.name === name);

describe("evaluateFusionOnlyGate", () => {
  it("passes when the OFF run reproduces the baseline", () => {
    const res = evaluateFusionOnlyGate(report(baselineRows()), report(baselineRows()), cfg);
    expect(res.pass).toBe(true);
    expect(res.drops).toEqual([]);
    expect(res.checks.map((c) => `${c.active ? (c.pass ? "PASS" : "FAIL") : "info"} ${c.name} — ${c.detail}`)).toEqual([
      "PASS fusion-only: run is rerank-off — rerank off, 0 reranked rows",
      "PASS fusion-only hybrid: broken Hit@1 queries — 0 broken (allowed 0)",
      "info fusion-only hybrid: cross-lingual (report-only) — 0 broken",
      "PASS fusion-only vector: broken Hit@1 queries — 0 broken (allowed 0)",
      "info fusion-only vector: cross-lingual (report-only) — 0 broken",
      "PASS fusion-only keyword: broken Hit@1 queries — 0 broken (allowed 0)",
      "info fusion-only keyword: cross-lingual (report-only) — 0 broken",
    ]);
  });

  it("fails when a baseline Hit@1=1 query breaks in hybrid", () => {
    const current = withRow(row("sp-01", "hybrid", "semantic-paraphrase", 0, ["book-105", "book-101", "book-102"]));
    const res = evaluateFusionOnlyGate(report(current), report(baselineRows()), cfg);
    expect(res.pass).toBe(false);
    expect(checkNamed(res, "fusion-only hybrid: broken Hit@1 queries")).toEqual({
      name: "fusion-only hybrid: broken Hit@1 queries",
      active: true,
      pass: false,
      detail: "1 broken (allowed 0): sp-01",
    });
    expect(res.drops).toEqual([
      "hybrid/sp-01 (semantic-paraphrase): baseline Hit@1=1 → now Hit@1=0 top3=[book-105, book-101, book-102]",
    ]);
  });

  it("fails on a break in keyword mode too (any mode)", () => {
    const current = withRow(row("sp-01", "keyword", "semantic-paraphrase", 0));
    const res = evaluateFusionOnlyGate(report(current), report(baselineRows()), cfg);
    expect(res.pass).toBe(false);
    expect(checkNamed(res, "fusion-only keyword: broken Hit@1 queries")?.detail).toBe("1 broken (allowed 0): sp-01");
  });

  it("counts a query missing from the current run as broken", () => {
    const current = baselineRows().filter((r) => !(r.id === "sp-01" && r.mode === "vector"));
    const res = evaluateFusionOnlyGate(report(current), report(baselineRows()), cfg);
    expect(res.pass).toBe(false);
    expect(res.drops).toEqual(["vector/sp-01 (semantic-paraphrase): baseline Hit@1=1 → now MISSING"]);
  });

  it("reports a cross-lingual break without failing the gate", () => {
    const current = withRow(row("xl-01", "hybrid", "cross-lingual", 0, ["book-111"]));
    const res = evaluateFusionOnlyGate(report(current), report(baselineRows()), cfg);
    expect(res.pass).toBe(true);
    expect(checkNamed(res, "fusion-only hybrid: cross-lingual (report-only)")).toEqual({
      name: "fusion-only hybrid: cross-lingual (report-only)",
      active: false,
      pass: true,
      detail: "1 broken: xl-01",
    });
    expect(checkNamed(res, "fusion-only hybrid: broken Hit@1 queries")?.detail).toBe("0 broken (allowed 0)");
    expect(res.drops).toEqual([
      "hybrid/xl-01 (cross-lingual) [report-only]: baseline Hit@1=1 → now Hit@1=0 top3=[book-111]",
    ]);
  });

  it("ignores queries the baseline already missed, and improvements", () => {
    const current = withRow(row("id-01", "hybrid", "exact-identifier", 1));
    const res = evaluateFusionOnlyGate(report(current), report(baselineRows()), cfg);
    expect(res.pass).toBe(true);
    expect(res.drops).toEqual([]);
  });

  it("fails when fed a run whose reranker actually ran", () => {
    const res = evaluateFusionOnlyGate(
      report(baselineRows(), "onnx-community/bge-reranker-v2-m3-ONNX q8", 118),
      report(baselineRows()),
      cfg,
    );
    expect(res.pass).toBe(false);
    expect(checkNamed(res, "fusion-only: run is rerank-off")).toEqual({
      name: "fusion-only: run is rerank-off",
      active: true,
      pass: false,
      detail: "rerank onnx-community/bge-reranker-v2-m3-ONNX q8, 118 reranked rows",
    });
  });
});
