// #389 §Eval: the `pnpm eval` paths that only pasted output used to prove — the per-pass print
// path (headline + headroom/saturation lines), a reranker-degraded run, the `--gate --rerank`
// rejection through the real CLI entry, and the allow-file entries checked inside `pnpm test`.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { Reranker } from "../../../src/semantic/reranker.js";
import { checkAllowEntries, loadAllowEntries, loadGateBaselines } from "./gate-guards.js";
import { evaluateFusionOnlyGate, type AllowEntry, type Thresholds } from "./gate.js";
import { hashEmbedder } from "./hash-embedder.js";
import { fromRankBaseline, type RankBaseline } from "./hash-gate.js";
import { runRetrievalEval, type EvalReport, type Mode, type PerQueryRow } from "./harness.js";
import { degradedWarning, parseArgs, passSummary, runPass } from "./run.js";
import { saturationLines } from "./saturation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

const agg = (hit1: number, ndcg10: number) => ({ n: 2, hit1, recall5: 1, mrr: hit1, ndcg10 });
const row = (id: string, mode: Mode, hit1: number): PerQueryRow => ({
  id,
  kind: "semantic-paraphrase",
  scope: "library",
  mode,
  ru: false,
  retrieved: ["101"],
  metrics: { hit1, recall5: 1, rr: hit1, ndcg10: hit1 },
});

/** A two-mode ON report: q1 solved by both modes, q2 by hybrid only; hybrid Hit@1 0.96. */
function onReport(rerankedRows: number): EvalReport {
  return {
    meta: { modes: ["hybrid", "keyword"], rerank: "ce q8", rerankedRows, live: false } as EvalReport["meta"],
    overall: { hybrid: agg(0.96, 0.975), keyword: agg(0.5, 0.6) },
    ruInvolved: { hybrid: agg(0.9, 0.95), keyword: agg(0.25, 0.3) },
    byKind: {},
    negatives: { hybrid: { n: 6, flaggedRate: 1 }, keyword: { n: 6, flaggedRate: 0 } },
    figureNegatives: {},
    perQuery: [row("q1", "hybrid", 1), row("q2", "hybrid", 1), row("q1", "keyword", 1), row("q2", "keyword", 0)],
  };
}

describe("run.ts print path (passSummary)", () => {
  it("prints the headline per mode, the headroom line, the saturation warning, axes and paths", () => {
    expect(passSummary(onReport(40), ["axis line"], { md: "r.md", json: "r.json" }).split("\n")).toEqual([
      "hybrid  overall nDCG@10 0.975 Hit@1 0.960 | RU nDCG@10 0.950 Hit@1 0.900 | negatives flagged 1.00",
      "keyword overall nDCG@10 0.600 Hit@1 0.500 | RU nDCG@10 0.300 Hit@1 0.250 | negatives flagged 0.00",
      "headroom: 1/2 positives solved at Hit@1 by every mode (50.0%)",
      "WARNING: eval saturated — rerank-ON hybrid Hit@1 0.960 >= 0.95; optimise cost/latency or add harder queries (#365)",
      "axis line",
      "report: r.md",
      "json:   r.json",
      "",
    ]);
  });

  it("a degraded ON run (0 reranked rows) prints no saturation warning", () => {
    expect(saturationLines(onReport(0))).toEqual(["headroom: 1/2 positives solved at Hit@1 by every mode (50.0%)"]);
  });
});

describe("reranker-degraded run (the model fails to load)", () => {
  const broken: Reranker = {
    async rerank() {
      throw new Error("RERANKER_UNAVAILABLE");
    },
    async warmup() {
      throw new Error("RERANKER_UNAVAILABLE");
    },
  };

  it("reports 0 reranked rows, warns, and the fusion-only gate refuses it as an OFF run", async () => {
    const report = await runRetrievalEval({
      indexDir: ":memory:",
      embedder: hashEmbedder,
      modes: ["hybrid"],
      reranker: broken,
      rerank: "fake-ce q8",
      gitSha: "test",
    });
    expect([report.meta.rerank, report.meta.rerankedRows]).toEqual(["fake-ce q8", 0]);
    expect(report.perQuery.filter((r) => r.mode === "hybrid").every((r) => r.reranked === false)).toBe(true);
    expect(degradedWarning(report, true)).toBe(
      "WARNING: rerank was ON but 0 rows reranked — model unavailable, run is reranker-degraded",
    );
    expect(degradedWarning(report, false)).toBeUndefined();
    const gate = evaluateFusionOnlyGate(report, report, thresholds.fusionOnly!);
    expect(gate.checks[0]).toEqual({
      name: "fusion-only: run is rerank-off",
      active: true,
      pass: false,
      detail: "rerank fake-ce q8, 0 reranked rows",
    });
    expect(gate.pass).toBe(false);
  }, 30_000);
});

describe("CLI entry rejects bad --gate flags before any model load", () => {
  const exec = promisify(execFile);
  const scratch = mkdtempSync(path.join(tmpdir(), "eval-cli-"));
  // The work dir is a FILE: if the flag check ever regressed, `mkdirSync(workDir)` fails at once,
  // before any model copy, index build or network fetch, instead of starting a real eval.
  const workFile = path.join(scratch, "work-dir-is-a-file");
  writeFileSync(workFile, "");
  const env = {
    ...process.env,
    CALIBRE_MCP_EVAL_WORK_DIR: workFile,
    CALIBRE_MCP_EVAL_MODEL_SOURCE: path.join(scratch, "no-such-model-dir"),
  };
  // a symlinked checkout (macOS /var → /private/var, or a linked worktree) must still run main()
  const linkedRoot = path.join(scratch, "linked-repo");
  symlinkSync(ROOT, linkedRoot, "dir");
  const cli = (entry: string, ...args: string[]) =>
    exec(process.execPath, ["--import", "tsx", entry, ...args], { cwd: ROOT, env, timeout: 20_000 }).then(
      (r) => ({ code: 0, stderr: r.stderr }),
      (e: { code?: number; stderr?: string }) => ({ code: e.code, stderr: e.stderr ?? "" }),
    );
  // only our own lines: Node 22 adds an ExperimentalWarning (node:sqlite) to stderr
  const evalLines = (r: { code?: number; stderr: string }) => ({
    code: r.code,
    eval: r.stderr.split("\n").filter((l) => l.startsWith("[eval]")),
  });
  const RUN = "test/eval/retrieval/run-cli.ts";

  it("--gate --rerank off → exit 1 with the drop --rerank message", async () => {
    expect(evalLines(await cli(RUN, "--gate", "--rerank", "off"))).toEqual({
      code: 1,
      eval: ["[eval] FAILED: --gate runs both rerank ON and OFF passes itself; drop --rerank."],
    });
  }, 30_000);

  it("--gate --live → exit 1, the live diff is never a gate", async () => {
    expect(evalLines(await cli(RUN, "--gate", "--live"))).toEqual({
      code: 1,
      eval: ["[eval] FAILED: --gate is fixture-only: the live diff is a triage artifact, never a gate (#85)."],
    });
  }, 30_000);

  it("through a symlinked path the entry still runs main() (no silent exit 0)", async () => {
    expect(evalLines(await cli(path.join(linkedRoot, RUN), "--gate", "--rerank", "off"))).toEqual({
      code: 1,
      eval: ["[eval] FAILED: --gate runs both rerank ON and OFF passes itself; drop --rerank."],
    });
  }, 30_000);
});

describe("run path emits the degraded-rerank warning (runPass)", () => {
  const broken: Reranker = {
    async rerank() {
      throw new Error("RERANKER_UNAVAILABLE");
    },
    async warmup() {},
  };

  it("an ON pass whose reranker can't load logs the WARNING line", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eval-pass-"));
    const args = parseArgs(["--modes", "keyword,hybrid", "--work-dir", dir, "--out-dir", dir, "--tag", "t"]);
    const lines: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runPass(args, {
        rerankOff: false,
        tag: "t",
        protectedPaths: [],
        deps: { embedder: hashEmbedder, reranker: broken, log: (m) => lines.push(m) },
      });
    } finally {
      write.mockRestore();
    }
    expect(lines).toContain("WARNING: rerank was ON but 0 rows reranked — model unavailable, run is reranker-degraded");
  }, 30_000);
});

describe("list-diff-allow.json entries are consistent with the frozen baselines (in pnpm test)", () => {
  const cfg = thresholds.listDiff!;
  const gate = loadGateBaselines(thresholds, read);
  const baselines = {
    on: gate.on,
    ...(gate.off ? { fusionOnly: gate.off } : {}),
    hash: fromRankBaseline(JSON.parse(read(thresholds.hashGate!.baselineReport!)) as RankBaseline),
  };

  it("the committed allow-file parses and every entry targets a real row with a new list and a reason", () => {
    expect(checkAllowEntries(loadAllowEntries(cfg, read), baselines, cfg.topK)).toEqual([]);
  });

  it("flags an entry for a missing row, a stale (baseline) list and an empty reason", () => {
    const sp01 = gate.on.perQuery.find((r) => r.mode === "hybrid" && r.id === "sp-01")!;
    const bad: AllowEntry[] = [
      { tier: "fusionOnly", mode: "vector", id: "no-such-id", retrieved: ["101"], reason: "x" },
      { tier: "on", mode: "hybrid", id: "sp-01", retrieved: sp01.retrieved, reason: " " },
    ];
    expect(checkAllowEntries(bad, baselines, cfg.topK)).toEqual([
      "fusionOnly/vector/no-such-id: no such row in the fusionOnly baseline",
      "on/hybrid/sp-01: allows the baseline's own top-10 list (stale entry)",
      "on/hybrid/sp-01: empty reason",
    ]);
  });

  it("an entry for a tier with no loaded baseline is a problem, not skipped", () => {
    const entry: AllowEntry = { tier: "fusionOnly", mode: "hybrid", id: "sp-01", retrieved: ["101"], reason: "x" };
    expect(checkAllowEntries([entry], { on: gate.on }, cfg.topK)).toEqual([
      "fusionOnly/hybrid/sp-01: no baseline loaded for tier fusionOnly",
    ]);
  });
});
