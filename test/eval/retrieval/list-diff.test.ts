// Unit tests for the top-10 list diff gate (#358): any change to a baseline row's top-10 list
// fails unless an allow-file entry names that exact new list with a reason. Covers the rank
// 2→3 shift that the old aggregate ε (0.005) let through, and the hash tier against its baseline.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reversed } from "./broken-store.js";
import { evaluateGate, evaluateListDiff, type AllowEntry, type Thresholds } from "./gate.js";
import type { EvalReport, Mode, PerQueryRow } from "./harness.js";
import { fromRankBaseline, runHashEval, type RankBaseline } from "./hash-gate.js";
import { ndcgAtK } from "./metrics.js";

function row(id: string, mode: Mode, retrieved: string[]): PerQueryRow {
  return {
    id,
    kind: "semantic-paraphrase",
    scope: "library",
    mode,
    ru: false,
    retrieved,
    metrics: { hit1: retrieved[0] === "101" ? 1 : 0, recall5: 1, rr: 1, ndcg10: 1 },
  };
}

function report(rows: PerQueryRow[]): EvalReport {
  return {
    meta: { modes: ["hybrid", "vector"] } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
  };
}

const TOP = ["105", "101", "102", "103", "104", "106", "107", "108", "109", "110"];
// relevant 101 moves from rank 2 to rank 3; Hit@1 is unchanged (0 → 0)
const SHIFTED = ["105", "102", "101", "103", "104", "106", "107", "108", "109", "110"];
const baseline = report([
  row("sp-01", "hybrid", TOP),
  row("sp-02", "hybrid", ["101", "102"]),
  row("sp-01", "vector", TOP),
]);

const opts = (allow: AllowEntry[] = []) => ({ tier: "on" as const, topK: 10, allow });

describe("evaluateListDiff", () => {
  it("passes when every baseline row reproduces its top-10 list", () => {
    const res = evaluateListDiff(baseline, baseline, opts());
    expect(res.pass).toBe(true);
    expect(res.drops).toEqual([]);
    expect(res.checks.map((c) => `${c.active ? (c.pass ? "PASS" : "FAIL") : "info"} ${c.name} — ${c.detail}`)).toEqual([
      "PASS top-10 list diff (on) — 0 changed, 0 allowed (of 3 rows)",
      "PASS allow-file entries (on) — 0 entries, all with a reason",
      "info allow-file unused entries (on) — 0 unused",
    ]);
  });

  it("the rank 2→3 shift passes the old ε but fails the list diff", () => {
    // per-query nDCG@10 delta of 2→3, averaged over the 59 fixture positives: below 0.005
    const at = (rank: number) =>
      ndcgAtK({ matches: Array.from({ length: 10 }, (_, i) => (i === rank - 1 ? ["r"] : [])), relevantCount: 1 }, 10);
    expect((at(2) - at(3)) / 59).toBeLessThan(0.005);

    const current = report([
      row("sp-01", "hybrid", SHIFTED),
      row("sp-02", "hybrid", ["101", "102"]),
      row("sp-01", "vector", TOP),
    ]);
    const res = evaluateListDiff(current, baseline, opts());
    expect(res.pass).toBe(false);
    expect(res.checks[0]!.detail).toBe("1 changed, 0 allowed (of 3 rows): hybrid/sp-01");
    expect(res.drops).toEqual(["hybrid/sp-01 (semantic-paraphrase): top-10 changed at rank 2: 101 → 102"]);
  });

  it("a gain also changes the list, so improvements ratchet", () => {
    const current = report([
      row("sp-01", "hybrid", ["101", ...TOP.filter((k) => k !== "101")]),
      row("sp-02", "hybrid", ["101", "102"]),
      row("sp-01", "vector", TOP),
    ]);
    expect(evaluateListDiff(current, baseline, opts()).pass).toBe(false);
  });

  it("a length change counts (a result dropped off the list)", () => {
    const current = report([row("sp-01", "hybrid", TOP), row("sp-02", "hybrid", ["101"]), row("sp-01", "vector", TOP)]);
    const res = evaluateListDiff(current, baseline, opts());
    expect(res.drops).toEqual(["hybrid/sp-02 (semantic-paraphrase): top-10 changed at rank 2: 102 → (end)"]);
  });

  it("a row missing from the current run counts as changed", () => {
    const current = report([row("sp-01", "hybrid", TOP), row("sp-01", "vector", TOP)]);
    const res = evaluateListDiff(current, baseline, opts());
    expect(res.pass).toBe(false);
    expect(res.drops).toEqual(["hybrid/sp-02 (semantic-paraphrase): MISSING"]);
  });

  it("only the top-k prefix is compared", () => {
    const current = report([
      row("sp-01", "hybrid", [...TOP, "999"]),
      row("sp-02", "hybrid", ["101", "102"]),
      row("sp-01", "vector", TOP),
    ]);
    const longBase = report([
      row("sp-01", "hybrid", [...TOP, "111"]),
      row("sp-02", "hybrid", ["101", "102"]),
      row("sp-01", "vector", TOP),
    ]);
    expect(evaluateListDiff(current, longBase, opts()).pass).toBe(true);
  });

  it("an allow entry with the exact new list and a reason lets the change through", () => {
    const current = report([
      row("sp-01", "hybrid", SHIFTED),
      row("sp-02", "hybrid", ["101", "102"]),
      row("sp-01", "vector", TOP),
    ]);
    const allow: AllowEntry[] = [
      { tier: "on", mode: "hybrid", id: "sp-01", retrieved: SHIFTED, reason: "intended: #999 demotes 101" },
    ];
    const res = evaluateListDiff(current, baseline, opts(allow));
    expect(res.pass).toBe(true);
    expect(res.checks[0]!.detail).toBe("1 changed, 1 allowed (of 3 rows)");
    expect(res.drops).toEqual([]);
  });

  it("an allow entry for a different list does not cover the change", () => {
    const current = report([
      row("sp-01", "hybrid", SHIFTED),
      row("sp-02", "hybrid", ["101", "102"]),
      row("sp-01", "vector", TOP),
    ]);
    const allow: AllowEntry[] = [
      { tier: "on", mode: "hybrid", id: "sp-01", retrieved: TOP.slice().reverse(), reason: "other change" },
    ];
    const res = evaluateListDiff(current, baseline, opts(allow));
    expect(res.pass).toBe(false);
    expect(res.checks[2]).toMatchObject({ active: false, detail: "1 unused: hybrid/sp-01" });
  });

  it("entries for another tier are ignored", () => {
    const current = report([
      row("sp-01", "hybrid", SHIFTED),
      row("sp-02", "hybrid", ["101", "102"]),
      row("sp-01", "vector", TOP),
    ]);
    const allow: AllowEntry[] = [
      { tier: "hash", mode: "hybrid", id: "sp-01", retrieved: SHIFTED, reason: "hash only" },
    ];
    expect(evaluateListDiff(current, baseline, opts(allow)).pass).toBe(false);
  });

  it("an entry without a reason fails the gate", () => {
    const current = report([
      row("sp-01", "hybrid", SHIFTED),
      row("sp-02", "hybrid", ["101", "102"]),
      row("sp-01", "vector", TOP),
    ]);
    const allow: AllowEntry[] = [{ tier: "on", mode: "hybrid", id: "sp-01", retrieved: SHIFTED, reason: "  " }];
    const res = evaluateListDiff(current, baseline, opts(allow));
    expect(res.pass).toBe(false);
    expect(res.checks[1]).toEqual({
      name: "allow-file entries (on)",
      active: true,
      pass: false,
      detail: "1 entries, 1 without a reason: hybrid/sp-01",
    });
  });
});

describe("evaluateGate no longer gates aggregate ε (#358)", () => {
  it("emits no aggregate drift check even with a scoreDrift block", () => {
    const t = {
      baselineReport: "x.json",
      nonRegression: {},
      scoreDrift: { maxScoreEpsilon: 0.01, maxScoreModes: [] },
    } as unknown as Thresholds;
    const names = evaluateGate(baseline, baseline, t).checks.map((c) => c.name);
    expect(names).not.toContain("score drift: aggregate metrics");
    expect(names).toContain("score drift: per-query maxScore");
  });
});

describe("hash tier list diff vs hash-baseline.json", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;
  const frozen = JSON.parse(
    readFileSync(path.join(HERE, thresholds.hashGate!.baselineReport!), "utf8"),
  ) as RankBaseline;
  const allowFile = JSON.parse(readFileSync(path.join(HERE, thresholds.listDiff!.allowFile), "utf8")) as {
    entries: AllowEntry[];
  };
  const hashOpts = { tier: "hash" as const, topK: thresholds.listDiff!.topK, allow: allowFile.entries };

  it(
    "the current hash run reproduces every frozen top-10 list",
    async () => {
      const res = evaluateListDiff(await runHashEval(), fromRankBaseline(frozen), hashOpts);
      // the detail carries the re-freeze hint, so a failure prints how to fix it (#392)
      expect(res.drops, res.checks[0]!.detail).toEqual([]);
      expect(res.checks[0]!.detail).toBe("0 changed, 0 allowed (of 204 rows)");
    },
    thresholds.hashGate!.maxDurationMs,
  );

  it(
    "a reversed store changes lists in every mode",
    async () => {
      const report = await runHashEval({ patchDeps: (deps) => ({ ...deps, index: reversed(deps.index) }) });
      const res = evaluateListDiff(report, fromRankBaseline(frozen), hashOpts);
      expect(res.pass).toBe(false);
      const modes = new Set(res.drops.map((d) => d.split("/")[0]));
      expect([...modes].sort()).toEqual(["hybrid", "keyword", "vector"]);
    },
    thresholds.hashGate!.maxDurationMs,
  );
});
