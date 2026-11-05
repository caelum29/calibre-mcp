// #404 review: rerank-floor's sign test vs the current floor pairs QUERIES, not query×mode rows,
// so a query that flips in every mode counts once (rows of one query aren't independent).

import { describe, expect, it } from "vitest";
import type { EvalReport, Mode, PerQueryRow } from "./harness.js";
import { scoreFloors, type FloorThresholds } from "./rerank-floor.js";

const t: FloorThresholds = {
  candidates: [0.3, 0.01],
  currentFloor: 0.3,
  population: { fixture: { modes: ["hybrid", "vector", "keyword"] }, live: { modes: ["hybrid"] } },
  negativeSeparation: { kinds: ["negative"], marginFactor: 0.5 },
};

function row(id: string, mode: Mode, maxRerank: number): PerQueryRow {
  return {
    id,
    kind: "semantic-paraphrase",
    scope: "library",
    mode,
    ru: false,
    retrieved: [],
    reranked: true,
    maxScore: 0.85,
    maxRerank,
    metrics: { hit1: 1, recall5: 1, rr: 1, ndcg10: 1 },
  };
}

const MODES: Mode[] = ["hybrid", "vector", "keyword"];
const at001 = (rows: PerQueryRow[]) =>
  scoreFloors(t, { perQuery: rows } as EvalReport).verdicts.find((v) => v.floor === 0.01)!.vsCurrent;

describe("rerank-floor vsCurrent pairs by query", () => {
  it("one query un-flagged in all three modes counts once", () => {
    expect(at001(MODES.map((m) => row("q1", m, 0.05)))).toEqual({ unflagged: 1, newlyFlagged: 0, signP: 1 });
  });

  it("four queries flipping in three modes → n = 4, not 12", () => {
    const rows = ["q1", "q2", "q3", "q4"].flatMap((id) => MODES.map((m) => row(id, m, 0.05)));
    expect(at001(rows)).toEqual({ unflagged: 4, newlyFlagged: 0, signP: 0.125 });
  });

  it("a query that flips in one mode only still counts once", () => {
    const rows = [row("q1", "hybrid", 0.05), row("q1", "vector", 0.5), row("q1", "keyword", 0.5)];
    expect(at001(rows)).toEqual({ unflagged: 1, newlyFlagged: 0, signP: 1 });
  });
});
