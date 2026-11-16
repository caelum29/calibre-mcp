// negativesFlagged counts the `negative` kind only (#359 review): adjacent negatives are a
// capability kind with their own report-only axis and must never dilute or pad that count.

import { describe, expect, it } from "vitest";
import { evaluateGate, type Thresholds } from "./gate.js";
import type { EvalReport, PerQueryRow, QueryKind } from "./harness.js";

const row = (id: string, kind: QueryKind, flagged: boolean): PerQueryRow => ({
  id,
  kind,
  scope: "library",
  mode: "hybrid",
  ru: false,
  retrieved: [],
  flagged,
});
const report = (rows: PerQueryRow[]) =>
  ({
    meta: { modes: ["hybrid"] },
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
  }) as unknown as EvalReport;
const t: Thresholds = {
  baselineReport: "x",
  nonRegression: { hybrid: { maxBrokenHit1Queries: 0, negativesFlagged: 6 } },
};
const negs = (flagged: boolean[]) => flagged.map((f, i) => row(`neg-0${i + 1}`, "negative", f));
const adjacent = [row("an-01", "adjacent-negative", false), row("an-02", "adjacent-negative", false)];
const line = (rows: PerQueryRow[]) => {
  const c = evaluateGate(report(rows), report([]), t).checks.find(
    (x) => x.name === "non-regression hybrid: negatives flagged",
  )!;
  return `${c.pass ? "PASS" : "FAIL"} ${c.detail}`;
};

describe("negativesFlagged ignores adjacent negatives", () => {
  it("6 flagged negatives plus unflagged adjacent negatives pass with 6/6", () => {
    expect(line([...negs([true, true, true, true, true, true]), ...adjacent])).toBe("PASS 6/6 flagged (need 6)");
  });

  it("an unflagged original negative still fails", () => {
    expect(line([...negs([true, true, true, true, true, false]), ...adjacent])).toBe("FAIL 5/6 flagged (need 6)");
  });
});
