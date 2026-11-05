// Golden-set hash gate (#392 decision 2): every frozen baseline records the hash of the
// queries.json it was measured on, and a relevance-label edit since the freeze fails the gate
// even when every top-10 list is unchanged. Also pins the #392 decision 1 re-freeze hints.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateListDiff, type AllowEntry, type Thresholds } from "./gate.js";
import { currentGoldenSetHash, evaluateGoldenSet, goldenSetHash } from "./golden-set.js";
import type { EvalReport, Mode, PerQueryRow } from "./harness.js";
import { pruneHashAllowEntries } from "./hash-freeze-lib.js";
import { fromRankBaseline, runHashEval, toRankBaseline, type RankBaseline } from "./hash-gate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;
const QUERIES = readFileSync(path.join(HERE, "queries.json"), "utf8");

function reportWith(goldenSetHash: string | undefined, rows: PerQueryRow[] = []): EvalReport {
  return {
    meta: { modes: ["hybrid"], ...(goldenSetHash ? { goldenSetHash } : {}) } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
  };
}

/** queries.json with the first library-scope query's first relevant bookId swapped for 999. */
function withEditedLabel(text: string): string {
  const qs = JSON.parse(text) as Array<{ scope: string; relevant: unknown[] }>;
  const q = qs.find((x) => x.scope === "library" && typeof x.relevant[0] === "number")!;
  q.relevant[0] = 999;
  return JSON.stringify(qs, null, 2) + "\n";
}

describe("goldenSetHash", () => {
  it("is a sha256 of the golden set", () => {
    expect(goldenSetHash(QUERIES)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when one relevance label changes", () => {
    expect(goldenSetHash(withEditedLabel(QUERIES))).not.toBe(goldenSetHash(QUERIES));
  });

  it("changes when a query is added", () => {
    const qs = JSON.parse(QUERIES) as unknown[];
    expect(goldenSetHash(JSON.stringify([...qs, qs[0]]))).not.toBe(goldenSetHash(QUERIES));
  });

  it("ignores formatting (a reformat is not a golden-set change)", () => {
    expect(goldenSetHash(JSON.stringify(JSON.parse(QUERIES)))).toBe(goldenSetHash(QUERIES));
  });

  it("currentGoldenSetHash hashes the committed queries.json", () => {
    expect(currentGoldenSetHash()).toBe(goldenSetHash(QUERIES));
  });
});

describe("evaluateGoldenSet", () => {
  const H = goldenSetHash(QUERIES);
  const EDITED = goldenSetHash(withEditedLabel(QUERIES));

  it("passes when the run's golden set matches the baseline's", () => {
    const res = evaluateGoldenSet(reportWith(H), reportWith(H), "on");
    expect(res).toEqual({
      pass: true,
      drops: [],
      checks: [{ name: "golden set (on)", active: true, pass: true, detail: `matches baseline (${H.slice(0, 19)}…)` }],
    });
  });

  it("a relevance-label edit fails the gate, naming the re-freeze for the hash tier", () => {
    const res = evaluateGoldenSet(reportWith(EDITED), reportWith(H), "hash");
    expect(res.pass).toBe(false);
    expect(res.checks[0]!.detail).toBe(
      `baseline ${H.slice(0, 19)}… ≠ current ${EDITED.slice(0, 19)}… — queries.json or its relevance labels ` +
        "changed since the freeze; re-freeze with `pnpm eval:hash-freeze` (rule first, D-012)",
    );
  });

  it("names a fresh `pnpm eval` freeze for the model tiers", () => {
    const res = evaluateGoldenSet(reportWith(EDITED), reportWith(H), "fusionOnly");
    expect(res.checks[0]!.detail).toBe(
      `baseline ${H.slice(0, 19)}… ≠ current ${EDITED.slice(0, 19)}… — queries.json or its relevance labels ` +
        "changed since the freeze; re-freeze thresholds.json fusionOnly.baselineReport with a new `pnpm eval` run (rule first, D-012)",
    );
  });

  it("a baseline without a hash fails (it can't prove which golden set it measured)", () => {
    const res = evaluateGoldenSet(reportWith(H), reportWith(undefined), "on");
    expect(res.pass).toBe(false);
    expect(res.checks[0]!.detail).toBe(
      "baseline has no golden-set hash; re-freeze thresholds.json baselineReport with a new `pnpm eval` run (rule first, D-012)",
    );
  });

  it("a run without a hash fails too", () => {
    expect(evaluateGoldenSet(reportWith(undefined), reportWith(H), "on").pass).toBe(false);
  });
});

describe("rank baseline keeps the golden-set hash", () => {
  it("toRankBaseline and fromRankBaseline carry meta.goldenSetHash both ways", () => {
    const H = goldenSetHash(QUERIES);
    const frozen = toRankBaseline(reportWith(H));
    expect(frozen.goldenSetHash).toBe(H);
    expect(fromRankBaseline(frozen).meta.goldenSetHash).toBe(H);
  });
});

describe("every frozen baseline matches the committed golden set", () => {
  it("thresholds.goldenSet gates all three tiers", () => {
    expect(thresholds.goldenSet?.tiers).toEqual(["on", "fusionOnly", "hash"]);
  });

  it("the ON and OFF model baselines record the current queries.json hash", () => {
    for (const rel of [thresholds.baselineReport, thresholds.fusionOnly!.baselineReport!]) {
      const base = JSON.parse(readFileSync(path.join(HERE, rel), "utf8")) as EvalReport;
      expect(evaluateGoldenSet(reportWith(currentGoldenSetHash()), base, "on").checks[0]!.pass, rel).toBe(true);
    }
  });

  it(
    "the hash tier: a fresh hash run matches hash-baseline.json's golden set",
    async () => {
      const frozen = JSON.parse(
        readFileSync(path.join(HERE, thresholds.hashGate!.baselineReport!), "utf8"),
      ) as RankBaseline;
      const res = evaluateGoldenSet(await runHashEval(), fromRankBaseline(frozen), "hash");
      expect(res.checks.map((c) => `${c.pass ? "PASS" : "FAIL"} ${c.name}`)).toEqual(["PASS golden set (hash)"]);
    },
    thresholds.hashGate!.maxDurationMs,
  );
});

describe("list-diff failure names the re-freeze (#392 decision 1)", () => {
  const row = (id: string, mode: Mode, retrieved: string[]): PerQueryRow => ({
    id,
    kind: "semantic-paraphrase",
    scope: "library",
    mode,
    ru: false,
    retrieved,
  });
  const base = reportWith(undefined, [row("sp-01", "hybrid", ["101", "102"]), row("sp-02", "hybrid", ["103"])]);
  const moved = reportWith(undefined, [row("sp-01", "hybrid", ["102", "101"]), row("sp-02", "hybrid", ["103"])]);

  it("the hash tier names `pnpm eval:hash-freeze`", () => {
    const res = evaluateListDiff(moved, base, { tier: "hash", topK: 10, allow: [] });
    expect(res.checks[0]!.detail).toBe(
      "1 changed, 0 allowed (of 2 rows): hybrid/sp-01 — intended? re-freeze with `pnpm eval:hash-freeze` " +
        "(rule first, D-012) or add an allow-file entry with a reason",
    );
  });

  it("a passing hash tier carries no hint", () => {
    const res = evaluateListDiff(base, base, { tier: "hash", topK: 10, allow: [] });
    expect(res.checks[0]!.detail).toBe("0 changed, 0 allowed (of 2 rows)");
  });
});

describe("pruneHashAllowEntries (re-freeze leaves no stale hash entries)", () => {
  const e = (tier: AllowEntry["tier"], id: string): AllowEntry => ({
    tier,
    mode: "hybrid",
    id,
    retrieved: ["101"],
    reason: "r",
  });

  it("drops hash-tier entries and keeps the model tiers'", () => {
    const file = { $comment: "c", entries: [e("hash", "a"), e("on", "b"), e("fusionOnly", "c"), e("hash", "d")] };
    expect(pruneHashAllowEntries(file)).toEqual({
      file: { $comment: "c", entries: [e("on", "b"), e("fusionOnly", "c")] },
      removed: ["hybrid/a", "hybrid/d"],
    });
  });

  it("no hash entries → file unchanged, nothing removed", () => {
    const file = { $comment: "c", entries: [e("on", "b")] };
    expect(pruneHashAllowEntries(file)).toEqual({ file, removed: [] });
  });
});
