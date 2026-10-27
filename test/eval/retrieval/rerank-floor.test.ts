// Unit tests for the RERANK_FLOOR scorer: synthetic reports exercise the replayed flag rule,
// the negative-separation margin, and the selection rule (adopt / current floor stays).

import { describe, expect, it } from "vitest";
import type { EvalReport, PerQueryRow, QueryKind } from "./harness.js";
import { flagged, scoreFloors, type FloorThresholds } from "./rerank-floor.js";

const t: FloorThresholds = {
  candidates: [0.3, 0.1, 0.01],
  currentFloor: 0.3,
  population: { fixture: { modes: ["hybrid"] }, live: { modes: ["hybrid"] } },
  negativeSeparation: { kinds: ["negative", "figure-negative"], marginFactor: 0.5 },
};

function row(id: string, kind: QueryKind, maxRerank: number, extra: Partial<PerQueryRow> = {}): PerQueryRow {
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
    ...extra,
  };
}

const report = (perQuery: PerQueryRow[]) => ({ perQuery }) as EvalReport;

describe("rerank-floor scorer", () => {
  it("replays confidence(): cosine floor OR rerank floor; figures skip the cosine half", () => {
    expect(flagged(row("a", "semantic-paraphrase", 0.5, { maxScore: 0.7 }), 0.3)).toBe(true);
    expect(flagged(row("a", "semantic-paraphrase", 0.2), 0.3)).toBe(true);
    expect(flagged(row("a", "semantic-paraphrase", 0.5), 0.3)).toBe(false);
    expect(flagged(row("f", "figure-caption", 0.5, { target: "figures", maxScore: 0.5 }), 0.3)).toBe(false);
  });

  it("adopts the lowest-false-flag floor that still separates negatives with margin", () => {
    const res = scoreFloors(
      t,
      report([
        row("p1", "semantic-paraphrase", 0.05),
        row("p2", "exact-identifier", 0.5),
        row("n1", "negative", 0.004),
      ]),
    );
    expect(res.verdicts.map((v) => v.separationPass)).toEqual([true, true, true]);
    expect(res.selected).toBe(0.01);
    expect(res.adopted).toBe(true);
    expect(res.cleanSeparation).toBe(true);
  });

  it("keeps the current floor when no candidate improves by >= 0.15", () => {
    const res = scoreFloors(
      t,
      report([
        row("p1", "semantic-paraphrase", 0.001),
        row("p2", "exact-identifier", 0.5),
        row("n1", "negative", 0.004),
      ]),
    );
    expect(res.adopted).toBe(false);
    expect(res.selected).toBe(0.3);
    expect(res.cleanSeparation).toBe(false);
  });

  it("keeps the current floor when the zeroBroken gate is red, even if a candidate wins", () => {
    const rows = [
      row("p1", "semantic-paraphrase", 0.05),
      row("p2", "exact-identifier", 0.5),
      row("n1", "negative", 0.004),
    ];
    const res = scoreFloors(t, report(rows), undefined, false);
    expect([res.best, res.selected, res.adopted]).toEqual([0.01, 0.3, false]);
  });

  it("fails separation when a negative sits above F * margin", () => {
    const res = scoreFloors(t, report([row("p1", "semantic-paraphrase", 0.5), row("n1", "negative", 0.008)]));
    expect(res.verdicts.find((v) => v.floor === 0.01)!.separationPass).toBe(false);
  });
});
