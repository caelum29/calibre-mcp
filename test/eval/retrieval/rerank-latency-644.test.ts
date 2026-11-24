// #644 rerank latency A/B seam on the eval side: the `pnpm eval` rerank flags reach retrieve()
// (and the report meta), and the pre-registered `thresholds.rerankLatency` block — rule, arms,
// protocol, quality baseline — is shape-checked so a typo can't silently change an arm.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RerankCallOptions, Reranker } from "../../../src/semantic/reranker.js";
import { rerankLatencyArms } from "./gate-guards.js";
import type { Thresholds } from "./gate.js";
import { hashEmbedder } from "./hash-embedder.js";
import { parseArgs, runPass } from "./run.js";

const HERE = import.meta.dirname;
const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;

describe("pnpm eval rerank flags (#644)", () => {
  it("parses --rerank-pool, --rerank-max-tokens and --adaptive-pool", () => {
    const a = parseArgs(["--rerank-pool", "20", "--rerank-max-tokens", "256", "--adaptive-pool"]);
    expect([a.rerankPool, a.rerankMaxTokens, a.adaptivePool]).toEqual([20, 256, true]);
  });

  it("leaves all three unset by default", () => {
    const a = parseArgs([]);
    expect([a.rerankPool, a.rerankMaxTokens, a.adaptivePool]).toEqual([undefined, undefined, false]);
  });

  it.each([["0"], ["-5"], ["2.5"], ["abc"]])("rejects --rerank-pool %s", (v) => {
    expect(() => parseArgs(["--rerank-pool", v])).toThrow(`--rerank-pool needs a positive integer, got "${v}"`);
  });

  it("rejects a non-integer --rerank-max-tokens", () => {
    expect(() => parseArgs(["--rerank-max-tokens", "1e9x"])).toThrow(
      '--rerank-max-tokens needs a positive integer, got "1e9x"',
    );
  });

  it("a pass with --rerank-pool 4 --rerank-max-tokens 128 scores at most 4 pairs at 128 tokens and records both", async () => {
    const calls: Array<{ pairs: number; opts?: RerankCallOptions }> = [];
    const reranker: Reranker = {
      async rerank(_q, ps, opts) {
        calls.push({ pairs: ps.length, ...(opts ? { opts } : {}) });
        return ps.map((_, i) => 0.9 - i * 0.01);
      },
      async warmup() {},
    };
    const dir = mkdtempSync(path.join(tmpdir(), "eval-644-"));
    const flags = ["--modes", "hybrid", "--work-dir", dir, "--out-dir", dir, "--tag", "t"];
    const args = parseArgs([...flags, "--rerank-pool", "4", "--rerank-max-tokens", "128"]);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    let meta: unknown;
    try {
      const { report } = await runPass(args, {
        rerankOff: false,
        tag: "t",
        protectedPaths: [],
        deps: { embedder: hashEmbedder, reranker, log: () => {} },
      });
      meta = report.meta.rerankOptions;
    } finally {
      write.mockRestore();
    }
    expect({
      maxPairs: Math.max(...calls.map((c) => c.pairs)),
      tokens: [...new Set(calls.map((c) => c.opts?.maxTokens))],
      meta,
    }).toEqual({ maxPairs: 4, tokens: [128], meta: { rerankPool: 4, rerankMaxTokens: 128 } });
  }, 60_000);
});

describe("thresholds.rerankLatency (#644): pre-registered arms", () => {
  it("the committed block declares the baseline, the candidate arms, the combinations and the reference row", () => {
    const arms = rerankLatencyArms(thresholds);
    expect(Object.fromEntries([...arms].map(([name, a]) => [name, [a.role, a.options, a.onlyIf ?? []]]))).toEqual({
      baseline: ["baseline", {}, []],
      trunc256: ["candidate", { rerankMaxTokens: 256 }, []],
      pool20: ["candidate", { rerankPool: 20 }, []],
      pool15: ["candidate", { rerankPool: 15 }, []],
      adaptive: ["candidate", { adaptivePool: true }, []],
      "trunc256-pool20": ["combination", { rerankMaxTokens: 256, rerankPool: 20 }, ["trunc256", "pool20"]],
      "trunc256-pool15": ["combination", { rerankMaxTokens: 256, rerankPool: 15 }, ["trunc256", "pool15"]],
      pool50: ["reference", { rerankPool: 50 }, []],
    });
  });

  it("the committed rule: ≥30% median warm hybrid latency drop, hit@3 ≤1 point overall, ≤3 per category", () => {
    const rule = (thresholds.rerankLatency as { rule: Record<string, unknown> }).rule;
    expect([rule.minLatencyDrop, rule.maxHit3DropOverallPoints, rule.maxHit3DropPerCategoryPoints]).toEqual([
      0.3, 1, 3,
    ]);
  });

  const withBlock = (block: unknown) =>
    ({ baselineReport: "r.json", nonRegression: {}, rerankLatency: block }) as unknown as Thresholds;
  const ok = (arms: unknown) => ({
    rule: { minLatencyDrop: 0.3, maxHit3DropOverallPoints: 1, maxHit3DropPerCategoryPoints: 3 },
    arms,
  });

  it("no block → no arms", () => {
    expect(rerankLatencyArms({ baselineReport: "r.json", nonRegression: {} }).size).toBe(0);
  });

  it("rejects an unknown top-level key", () => {
    expect(() => rerankLatencyArms(withBlock({ ...ok({ b: { role: "baseline", options: {} } }), armz: {} }))).toThrow(
      "thresholds.rerankLatency has unknown key armz",
    );
  });

  it("rejects an unknown option key", () => {
    const arms = { b: { role: "baseline", options: {} }, x: { role: "candidate", options: { rerankPoool: 20 } } };
    expect(() => rerankLatencyArms(withBlock(ok(arms)))).toThrow(
      "thresholds.rerankLatency.arms.x.options has unknown key rerankPoool",
    );
  });

  it("rejects a non-integer pool", () => {
    const arms = { b: { role: "baseline", options: {} }, x: { role: "candidate", options: { rerankPool: 12.5 } } };
    expect(() => rerankLatencyArms(withBlock(ok(arms)))).toThrow(
      "thresholds.rerankLatency.arms.x.options.rerankPool must be a positive integer",
    );
  });

  it("rejects a block without exactly one baseline arm", () => {
    const arms = { a: { role: "baseline", options: {} }, b: { role: "baseline", options: {} } };
    expect(() => rerankLatencyArms(withBlock(ok(arms)))).toThrow(
      "thresholds.rerankLatency.arms needs exactly one baseline arm (found 2)",
    );
  });

  it("rejects onlyIf naming an undeclared arm", () => {
    const arms = {
      b: { role: "baseline", options: {} },
      c: { role: "combination", options: { rerankPool: 20 }, onlyIf: ["nope"] },
    };
    expect(() => rerankLatencyArms(withBlock(ok(arms)))).toThrow(
      'thresholds.rerankLatency.arms.c.onlyIf names an undeclared arm "nope"',
    );
  });

  it("rejects a rule whose latency drop is not a fraction", () => {
    const block = { ...ok({ b: { role: "baseline", options: {} } }), rule: { minLatencyDrop: 30 } };
    expect(() => rerankLatencyArms(withBlock(block))).toThrow(
      "thresholds.rerankLatency.rule.minLatencyDrop must be a number in (0, 1)",
    );
  });
});
