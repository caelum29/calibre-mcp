// `--compare` pairing warnings (#387 review): a compare that pairs fewer queries than either
// report holds (fixture vs live) must say so instead of silently comparing a subset.

import { describe, expect, it } from "vitest";
import type { EvalReport, Mode, PerQueryRow } from "./harness.js";
import { pairingWarnings } from "./stats.js";

const row = (id: string, mode: Mode = "hybrid"): PerQueryRow => ({
  id,
  kind: "semantic-paraphrase",
  scope: "library",
  mode,
  ru: false,
  retrieved: [],
  metrics: { hit1: 1, recall5: 1, rr: 1, ndcg10: 1 },
});
const report = (rows: PerQueryRow[], modes: Mode[] = ["hybrid"]): EvalReport =>
  ({
    meta: { modes },
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
  }) as unknown as EvalReport;

describe("pairingWarnings", () => {
  it("is silent when both reports hold the same queries", () => {
    expect(pairingWarnings(report([row("a"), row("b")]), report([row("b"), row("a")]))).toEqual([]);
  });

  it("warns when b holds only a subset of a (fixture vs live)", () => {
    expect(
      pairingWarnings(report([row("a"), row("b"), row("c")]), report([row("a")]), "fixture.json", "live.json"),
    ).toEqual([
      "WARNING: hybrid pairs only 1 queries — fixture.json has 3, live.json has 1 with rank metrics; the rest are not compared",
    ]);
  });

  it("warns when a holds fewer than b", () => {
    expect(pairingWarnings(report([row("a")]), report([row("a"), row("z")]))).toEqual([
      "WARNING: hybrid pairs only 1 queries — a has 1, b has 2 with rank metrics; the rest are not compared",
    ]);
  });

  it("checks each shared mode on its own", () => {
    const modes: Mode[] = ["hybrid", "vector"];
    const a = report([row("a"), row("a", "vector"), row("b", "vector")], modes);
    const b = report([row("a"), row("a", "vector")], modes);
    expect(pairingWarnings(a, b)).toEqual([
      "WARNING: vector pairs only 1 queries — a has 2, b has 1 with rank metrics; the rest are not compared",
    ]);
  });
});
