// Tier-0 eval gate inside `pnpm test` (#357): the hash-embedder golden run must not break any
// Hit@1 the frozen hash-baseline.json holds, in any mode — compared by rank, so it holds on
// Linux CI too. A deliberately reversed retriever must fail it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reversed } from "./broken-store.js";
import type { Thresholds } from "./gate.js";
import { evaluateHashGate, fromRankBaseline, runHashEval, toRankBaseline, type RankBaseline } from "./hash-gate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;
const rule = thresholds.hashGate!;
const baseline = JSON.parse(readFileSync(path.join(HERE, rule.baselineReport!), "utf8")) as RankBaseline;

const GATE_CHECKS = [
  "non-regression hybrid: broken Hit@1 queries",
  "non-regression vector: broken Hit@1 queries",
  "non-regression keyword: broken Hit@1 queries",
];

describe("hash-embedder tier-0 gate", () => {
  it(
    "the current pipeline breaks no baseline Hit@1 in any mode",
    async () => {
      const result = evaluateHashGate(await runHashEval(), baseline, rule);
      expect(result.drops).toEqual([]);
      expect(result.checks.map((c) => `${c.pass ? "PASS" : "FAIL"} ${c.name} — ${c.detail}`)).toEqual([
        "PASS non-regression hybrid: broken Hit@1 queries — 0 broken (allowed 0)",
        "PASS non-regression vector: broken Hit@1 queries — 0 broken (allowed 0)",
        "PASS non-regression keyword: broken Hit@1 queries — 0 broken (allowed 0)",
      ]);
      expect(result.pass).toBe(true);
    },
    rule.maxDurationMs,
  );

  it(
    "a reversed-ranking store fails every mode",
    async () => {
      const report = await runHashEval({ patchDeps: (deps) => ({ ...deps, index: reversed(deps.index) }) });
      const result = evaluateHashGate(report, baseline, rule);
      expect(result.pass).toBe(false);
      expect(result.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(GATE_CHECKS);
    },
    rule.maxDurationMs,
  );

  it("the rule and baseline cover all three modes and the full golden set", () => {
    expect(Object.keys(rule.nonRegression).sort()).toEqual(["hybrid", "keyword", "vector"]);
    expect(baseline.modes).toEqual(["hybrid", "vector", "keyword"]);
    expect(baseline.perQuery).toHaveLength(baseline.queryCount * 3);
  });
});

describe("rank baseline round-trip", () => {
  const frozen: RankBaseline = {
    $comment: "test",
    embedder: "test",
    gitSha: "abc1234",
    queryCount: 4,
    modes: ["hybrid"],
    perQuery: [
      { id: "a", kind: "semantic-paraphrase", mode: "hybrid", rank: 1, retrieved: ["101"] },
      { id: "b", kind: "semantic-paraphrase", mode: "hybrid", rank: 3, retrieved: ["105", "102", "101"] },
      { id: "c", kind: "exact-identifier", mode: "hybrid", rank: null, retrieved: [] },
      { id: "n", kind: "negative", mode: "hybrid", retrieved: [] },
    ],
  };

  it("derives Hit@1 and reciprocal rank from the frozen rank", () => {
    const rows = fromRankBaseline(frozen).perQuery.map((r) => [r.id, r.metrics?.hit1, r.metrics?.rr]);
    expect(rows).toEqual([
      ["a", 1, 1],
      ["b", 0, 1 / 3],
      ["c", 0, 0],
      ["n", undefined, undefined],
    ]);
  });

  it("toRankBaseline(fromRankBaseline(x)) keeps every rank", () => {
    expect(toRankBaseline(fromRankBaseline(frozen)).perQuery).toEqual(frozen.perQuery);
  });

  it("a rank 1 → 2 shift breaks the gate; rank 3 → 5 does not (Hit@1 rule)", () => {
    const shifted: RankBaseline = {
      ...frozen,
      perQuery: frozen.perQuery.map((r) => (r.id === "a" ? { ...r, rank: 2 } : r.id === "b" ? { ...r, rank: 5 } : r)),
    };
    const result = evaluateHashGate(fromRankBaseline(shifted), frozen, {
      ...rule,
      nonRegression: { hybrid: { maxBrokenHit1Queries: 0 } },
    });
    expect(result.pass).toBe(false);
    expect(result.checks.map((c) => c.detail)).toEqual(["1 broken (allowed 0): a"]);
  });
});
