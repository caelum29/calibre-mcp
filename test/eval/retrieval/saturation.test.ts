// Unit tests for the eval saturation signals (#365): headroom share (positives every mode in the
// run solves at Hit@1) and the warning when the shipped config (rerank ON, hybrid) hits Hit@1 >= 0.95.

import { describe, expect, it } from "vitest";
import type { EvalReport, Mode, PerQueryRow, QueryKind } from "./harness.js";
import { headroom, saturationWarning } from "./saturation.js";

function row(id: string, mode: Mode, kind: QueryKind, hit1?: 0 | 1): PerQueryRow {
  return {
    id,
    kind,
    scope: "library",
    mode,
    ru: false,
    retrieved: [],
    ...(hit1 === undefined ? { flagged: true } : { metrics: { hit1, recall5: hit1, rr: hit1, ndcg10: hit1 } }),
  };
}

function report(opts: { rerank: string; modes: Mode[]; hybridHit1?: number; perQuery?: PerQueryRow[] }): EvalReport {
  return {
    meta: { modes: opts.modes, rerank: opts.rerank } as EvalReport["meta"],
    overall:
      opts.hybridHit1 === undefined ? {} : { hybrid: { n: 59, hit1: opts.hybridHit1, recall5: 1, mrr: 1, ndcg10: 1 } },
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: opts.perQuery ?? [],
  };
}

const ON = "onnx-community/bge-reranker-v2-m3-ONNX q8";

describe("saturationWarning", () => {
  it("warns at exactly 0.95 hybrid Hit@1 with rerank ON", () => {
    const w = saturationWarning(report({ rerank: ON, modes: ["hybrid"], hybridHit1: 0.95 }));
    expect(w).toBe(
      "WARNING: eval saturated — rerank-ON hybrid Hit@1 0.950 >= 0.95; optimise cost/latency or add harder queries (#365)",
    );
  });

  it("warns above the threshold too", () => {
    const w = saturationWarning(report({ rerank: ON, modes: ["hybrid", "vector"], hybridHit1: 1 }));
    expect(w).toBe(
      "WARNING: eval saturated — rerank-ON hybrid Hit@1 1.000 >= 0.95; optimise cost/latency or add harder queries (#365)",
    );
  });

  it("stays silent just below the threshold (today's 0.9492 baseline)", () => {
    expect(saturationWarning(report({ rerank: ON, modes: ["hybrid"], hybridHit1: 0.9492 }))).toBeUndefined();
  });

  it("stays silent on a --rerank off run even when saturated", () => {
    expect(saturationWarning(report({ rerank: "off", modes: ["hybrid"], hybridHit1: 1 }))).toBeUndefined();
  });

  it("stays silent when hybrid was not run", () => {
    expect(saturationWarning(report({ rerank: ON, modes: ["vector"] }))).toBeUndefined();
  });
});

describe("headroom", () => {
  it("counts positives solved at Hit@1 by every mode in the run; negatives excluded", () => {
    const modes: Mode[] = ["hybrid", "vector", "keyword"];
    const perQuery = [
      // q1: solved everywhere
      ...modes.map((m) => row("q1", m, "semantic-paraphrase", 1)),
      // q2: keyword misses -> headroom
      row("q2", "hybrid", "exact-identifier", 1),
      row("q2", "vector", "exact-identifier", 1),
      row("q2", "keyword", "exact-identifier", 0),
      // q3: solved everywhere
      ...modes.map((m) => row("q3", m, "cross-lingual", 1)),
      // q4: missed everywhere
      ...modes.map((m) => row("q4", m, "ru-monolingual", 0)),
      // negatives have no rank metrics and never count
      ...modes.map((m) => row("neg-1", m, "negative")),
    ];
    expect(headroom(report({ rerank: ON, modes, perQuery }))).toEqual({
      positives: 4,
      solvedByAll: 2,
      share: 0.5,
    });
  });

  it("returns share 0 for a run with no positives", () => {
    const perQuery = [row("neg-1", "hybrid", "negative")];
    expect(headroom(report({ rerank: ON, modes: ["hybrid"], perQuery }))).toEqual({
      positives: 0,
      solvedByAll: 0,
      share: 0,
    });
  });

  it("rounds the share to 4 decimals like the other aggregates", () => {
    const perQuery = [
      row("a", "hybrid", "semantic-paraphrase", 1),
      row("b", "hybrid", "semantic-paraphrase", 1),
      row("c", "hybrid", "semantic-paraphrase", 0),
    ];
    expect(headroom(report({ rerank: ON, modes: ["hybrid"], perQuery })).share).toBe(0.6667);
  });
});
