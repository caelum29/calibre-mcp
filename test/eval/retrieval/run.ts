// `pnpm eval` — the golden-query retrieval eval CLI (NOT part of `pnpm test`: it embeds the
// fixture corpus with the real e5 model). Reuses the locally cached model (no re-download),
// builds a fresh fixture index in a work dir, and writes committed md+json reports.
//
// Usage:
//   pnpm eval [--modes hybrid,vector,keyword] [--topk 10] [--tag baseline]
//             [--rerank off] [--rrf-weights 1.5,1.0] [--work-dir <dir>] [--out-dir <dir>]
//             [--live] [--gate]
//   pnpm eval --compare a.json b.json
//
// --compare: paired per-mode/per-kind stats of two existing reports (Δ nDCG@10, bootstrap CI,
//   permutation p, Hit@1 flip sign test, MDE, UNDERPOWERED flag; stats.ts, #358). No eval run.
// --gate: after the run, compare against thresholds.json + its frozen baseline report and
//   print mechanical PASS/FAIL per declared gate (#85, D-012). Then a second, fusion-only pass
//   with --rerank off vs thresholds.fusionOnly + its own frozen baseline (#356). Each pass also
//   runs the top-10 list diff vs its baseline + list-diff-allow.json (#358); both passes
//   print, exit 1 if either fails. Fixture-only (the live diff is a triage artifact, not a
//   gate — thresholds.liveEval); rejects --rerank (the gate sets it per pass).
//
// Every run prints the headroom share and, when rerank-ON hybrid Hit@1 >= 0.95, a saturation
//   warning (#365, saturation.ts); both are skipped on --live (unverified labels).
// Offline path: deterministic — two runs at the same commit produce identical JSON apart from
//   the per-row durationMs timings (#363 latency axis).
// --live: runs library-scope queries against a COPY of the real library index using
//   live-relevance.json labels (UNVERIFIED until Artem confirms). Never touches the
//   production index dir beyond reading; skip in CI.
// --rerank off: disables the cross-encoder rerank stage (D-011; on by default, mirroring
//   the shipped always-on behavior). First reranked run downloads the ~576 MB q8 model into
//   <work-dir>/models; a degraded run (model unreachable) reports 0 reranked rows.
// --rrf-weights v,k: weighted-RRF weights (vector, keyword) for this run only — the #142 sweep
//   seam via retrieve()'s opts.rrfWeights (#259); the shipped weights stay in retrieve.ts.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../src/config.js";
import type { Embedder } from "../../../src/semantic/embedder.js";
import { RERANKER_MODEL_ID, TransformersReranker, type Reranker } from "../../../src/semantic/reranker.js";
import {
  baselinePaths,
  checkGateArgs,
  loadAllowEntries,
  type GateBaselines,
  loadGateBaselines,
  refuseBaselineOverwrite,
} from "./gate-guards.js";
import {
  evaluateFusionOnlyGate,
  evaluateGate,
  evaluateListDiff,
  renderGate,
  type GateResult,
  type ListDiffTier,
  type Thresholds,
} from "./gate.js";
import { currentGoldenSetHash, evaluateGoldenSet } from "./golden-set.js";
import { ALL_MODES, renderMarkdown, runRetrievalEval, type EvalReport, type Mode } from "./harness.js";
import { ablationMatrix, computeAxes, renderAxes } from "./axes.js";
import { saturationLines } from "./saturation.js";
import { compareReports, pairingWarnings, renderCompare } from "./stats.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const progress = (msg: string) => process.stderr.write(`[eval] ${msg}\n`);

export interface CliArgs {
  live: boolean;
  gate: boolean;
  /** `--compare a.json b.json`: paired stats of two existing reports, no eval run (#358). */
  compare?: [string, string];
  modes: Mode[];
  topK: number;
  tag?: string;
  /** "off" disables the rerank stage; anything else is kept as the report label. */
  rerank?: string;
  rrfWeights?: number[];
  workDir: string;
  outDir: string;
}

/** Parse `pnpm eval` flags (exported for the #389 run-path test). */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    live: false,
    gate: false,
    modes: ALL_MODES,
    topK: 10,
    workDir: process.env.CALIBRE_MCP_EVAL_WORK_DIR ?? path.join(HERE, ".work"),
    outDir: path.join(HERE, "reports"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--live") args.live = true;
    else if (a === "--gate") args.gate = true;
    else if (a === "--compare") args.compare = [next(), next()];
    else if (a === "--modes") args.modes = next().split(",") as Mode[];
    else if (a === "--topk") args.topK = Number(next());
    else if (a === "--tag") args.tag = next();
    else if (a === "--rerank") args.rerank = next();
    else if (a === "--rrf-weights") args.rrfWeights = parseWeights(next());
    else if (a === "--work-dir") args.workDir = next();
    else if (a === "--out-dir") args.outDir = next();
    else if (a === "--help" || a === "-h") {
      process.stderr.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n\nimport")[0]! + "\n");
      process.exit(0);
    } else throw new Error(`unknown flag ${a} (see --help)`);
  }
  for (const m of args.modes) {
    if (!ALL_MODES.includes(m)) throw new Error(`unknown mode "${m}"`);
  }
  return args;
}

/** `"1.5,1.0"` → [1.5, 1.0]: exactly two finite non-negative weights (vector, keyword). */
function parseWeights(v: string): number[] {
  const w = v.split(",").map(Number);
  if (w.length !== 2 || w.some((x) => !Number.isFinite(x) || x < 0)) {
    throw new Error(`--rrf-weights needs two non-negative numbers "vector,keyword", got "${v}"`);
  }
  return w;
}

/**
 * The platform-default index dir (where a normal install caches the e5 model). Deliberately
 * ignores this process's CALIBRE_MCP_INDEX_DIR for the WORK dir so an eval can never write
 * into the production index; the env var is honored only as a read-only SOURCE (live mode /
 * model cache).
 */
function defaultIndexDir(): string {
  return loadConfig({} as NodeJS.ProcessEnv).indexDir;
}

/** Reuse an already-downloaded e5 model: copy the cache into the work dir once. */
function ensureModelCache(workDir: string): void {
  const dst = path.join(workDir, "models");
  if (existsSync(dst)) return;
  const src =
    process.env.CALIBRE_MCP_EVAL_MODEL_SOURCE ??
    path.join(process.env.CALIBRE_MCP_INDEX_DIR ?? defaultIndexDir(), "models");
  if (existsSync(src)) {
    progress(`copying cached model ${src} → ${dst}`);
    cpSync(src, dst, { recursive: true });
  } else {
    progress(`no cached model at ${src} — transformers.js will download once into ${dst}`);
  }
}

/** Store filename for a library id — mirrors SqliteIndexStore's sanitizer. */
function sqliteName(libraryId: string): string {
  return `${libraryId.replace(/[^A-Za-z0-9._-]/g, "_") || "default"}.sqlite`;
}

interface LiveRelevance {
  libraryId: string;
  labels: Record<string, number[]>;
}

/** Copy the real library's index into the work dir (read-only w.r.t. production). */
function prepareLive(workDir: string): LiveRelevance {
  const live = JSON.parse(readFileSync(path.join(HERE, "live-relevance.json"), "utf8")) as LiveRelevance;
  const srcDir = process.env.CALIBRE_MCP_INDEX_DIR ?? defaultIndexDir();
  const src = path.join(srcDir, sqliteName(live.libraryId));
  if (!existsSync(src)) {
    throw new Error(`live index not found: ${src} — build it first (calibre_build_index) or set CALIBRE_MCP_INDEX_DIR`);
  }
  const dst = path.join(workDir, sqliteName(live.libraryId));
  rmSync(dst, { force: true });
  cpSync(src, dst);
  progress(`copied live index ${src} → ${dst}`);
  return live;
}

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: HERE, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function headline(report: EvalReport): string {
  const lines: string[] = [];
  for (const mode of report.meta.modes) {
    const o = report.overall[mode];
    const r = report.ruInvolved[mode];
    const n = report.negatives[mode];
    if (o && r && n) {
      lines.push(
        `${mode.padEnd(7)} overall nDCG@10 ${o.ndcg10.toFixed(3)} Hit@1 ${o.hit1.toFixed(3)} | ` +
          `RU nDCG@10 ${r.ndcg10.toFixed(3)} Hit@1 ${r.hit1.toFixed(3)} | negatives flagged ${n.flaggedRate.toFixed(2)}`,
      );
    }
  }
  return lines.join("\n");
}

interface PassResult {
  report: EvalReport;
  mdPath: string;
  jsonPath: string;
}

/** Per-pass settings: rerank on/off, filename tag, the guarded baselines, the #363 axes block. */
interface PassOptions {
  rerankOff: boolean;
  tag: string | undefined;
  protectedPaths: string[];
  axesCfg?: Thresholds["reportOnlyAxes"];
  /** Test seam (#389): swap the e5 embedder / cross-encoder and capture the stderr log lines. */
  deps?: { embedder?: Embedder; reranker?: Reranker; log?: (msg: string) => void };
}

/** One eval run (fresh fixture index or live copy) → report written to outDir + stdout summary. */
export async function runPass(
  args: CliArgs,
  { rerankOff, tag, protectedPaths, axesCfg, deps = {} }: PassOptions,
): Promise<PassResult> {
  const log = deps.log ?? progress;
  const started = Date.now();
  const sha = gitSha();
  const date = new Date().toISOString().slice(0, 10);
  const base = [date, sha, tag, args.live ? "live" : undefined].filter(Boolean).join("-");
  const jsonPath = path.join(args.outDir, `${base}.json`);
  const mdPath = path.join(args.outDir, `${base}.md`);
  // checked before the run: a pass at a baseline's own date+sha would replace it at the end
  refuseBaselineOverwrite(jsonPath, protectedPaths);
  let live: LiveRelevance | undefined;
  // Fixture runs build into their own temp dir under the work dir, so two concurrent evals (or a
  // killed run's -wal/-shm leftovers) never share one sqlite file (#325: "disk I/O error").
  // Models are shared via a symlink — copying them per run would cost hundreds of MB.
  let indexDir = args.workDir;
  if (args.live) {
    live = prepareLive(args.workDir);
  } else {
    // Fresh fixture build every run — deterministic and immune to INDEX_VERSION bumps.
    indexDir = mkdtempSync(path.join(args.workDir, "run-"));
    const models = path.join(args.workDir, "models");
    if (existsSync(models)) symlinkSync(models, path.join(indexDir, "models"), "dir");
  }

  // Rerank stage mirrors the shipped default: ON for hybrid/vector unless --rerank off.
  const reranker = rerankOff
    ? undefined
    : (deps.reranker ??
      new TransformersReranker(loadConfig({ CALIBRE_MCP_INDEX_DIR: args.workDir } as NodeJS.ProcessEnv)));
  const rerankLabel = rerankOff ? "off" : (args.rerank ?? `${RERANKER_MODEL_ID} q8`);

  const report = await runRetrievalEval({
    indexDir,
    modes: args.modes,
    topK: args.topK,
    ...(reranker ? { reranker } : {}),
    ...(deps.embedder ? { embedder: deps.embedder } : {}),
    rerank: rerankLabel,
    gitSha: sha,
    // #363 latency axis; the CLI is the only caller that records wall-clock timings
    timing: true,
    ...(args.rrfWeights ? { rrfWeights: args.rrfWeights } : {}),
    ...(live ? { live } : {}),
    onProgress: log,
  }).finally(() => {
    // rmSync never follows the models symlink; it only unlinks it
    if (indexDir !== args.workDir) rmSync(indexDir, { recursive: true, force: true });
  });
  const degraded = degradedWarning(report, reranker !== undefined);
  if (degraded) log(degraded);

  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  // #363: report-only axes, skipped on --live like saturation (unverified labels)
  const axes = axesCfg && !args.live ? renderAxes(computeAxes(report), axesCfg) : [];
  writeFileSync(
    mdPath,
    renderMarkdown(report, base) + (axes.length ? `\n\n\`\`\`text\n${axes.join("\n")}\n\`\`\`` : "") + "\n",
  );

  log(`${rerankOff ? "rerank-off " : ""}pass done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  // CLI summary on stdout (this is a script, not the stdio MCP server).
  process.stdout.write(passSummary(report, axes, { md: mdPath, json: jsonPath }));
  return { report, mdPath, jsonPath };
}

/**
 * stderr warning for a run that wired the reranker but reranked nothing (model failed to load):
 * its numbers are fusion-only although labelled ON. Exported for the #389 test.
 */
export function degradedWarning(report: EvalReport, rerankerWired: boolean): string | undefined {
  return rerankerWired && report.meta.rerankedRows === 0
    ? "WARNING: rerank was ON but 0 rows reranked — model unavailable, run is reranker-degraded"
    : undefined;
}

/** A pass's stdout summary: headline, saturation lines, #363 axes, report paths (#389 test seam). */
export function passSummary(report: EvalReport, axes: string[], paths: { md: string; json: string }): string {
  return (
    `${headline(report)}\n${saturationLines(report).join("\n")}\n` +
    (axes.length ? `${axes.join("\n")}\n` : "") +
    `report: ${paths.md}\njson:   ${paths.json}\n`
  );
}

/** Concatenate two gate outcomes into one pass section (gate checks + list diff). */
function mergeGates(a: GateResult, b: GateResult): GateResult {
  return { pass: a.pass && b.pass, checks: [...a.checks, ...b.checks], drops: [...a.drops, ...b.drops] };
}

/**
 * Exit before the ~8 min ON pass when a baseline was frozen on another queries.json (#392):
 * the per-pass golden-set check would fail anyway, after the whole run.
 */
function failFastOnGoldenSet(baselines: GateBaselines, tiers: ListDiffTier[]): void {
  const now = { meta: { goldenSetHash: currentGoldenSetHash() } } as EvalReport;
  const pairs: Array<[ListDiffTier, EvalReport | undefined]> = [
    ["on", baselines.on],
    ["fusionOnly", baselines.off],
  ];
  const failed = pairs
    .filter(([tier, base]) => base && tiers.includes(tier))
    .map(([tier, base]) => evaluateGoldenSet(now, base!, tier))
    .filter((r) => !r.pass);
  if (failed.length === 0) return;
  process.stdout.write(`${failed.map(renderGate).join("\n\n")}\n\nOVERALL GATE: FAIL\n`);
  process.exit(1);
}

/** `--compare`: paired per-kind stats of two reports already on disk; never runs an eval. */
function compareFiles([a, b]: [string, string]): void {
  const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as EvalReport;
  const [ra, rb] = [read(a), read(b)];
  const [la, lb] = [path.basename(a), path.basename(b)];
  const warnings = pairingWarnings(ra, rb, la, lb);
  for (const w of warnings) progress(w);
  // warnings also follow the table, so a pasted table can't lose them
  process.stdout.write(`${[renderCompare(compareReports(ra, rb), la, lb), ...warnings].join("\n")}\n`);
}

/** The eval CLI body; invoked only by run-cli.ts, so importing this module starts nothing. */
export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) {
    if (args.gate || args.live)
      throw new Error("--compare reads two existing reports; it can't combine with --gate/--live.");
    compareFiles(args.compare);
    return;
  }
  checkGateArgs(args);
  const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;
  const protectedPaths = baselinePaths(thresholds, HERE);
  const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");
  // load baselines + allow-file before the ~8 min ON pass, so a missing one fails in seconds
  const baselines = args.gate ? loadGateBaselines(thresholds, read) : undefined;
  const listDiff =
    args.gate && thresholds.listDiff
      ? { ...thresholds.listDiff, allow: loadAllowEntries(thresholds.listDiff, read) }
      : undefined;
  const goldenTiers: ListDiffTier[] = thresholds.goldenSet?.tiers ?? [];
  if (baselines) failFastOnGoldenSet(baselines, goldenTiers);
  mkdirSync(args.workDir, { recursive: true });
  ensureModelCache(args.workDir);

  const axesCfg = thresholds.reportOnlyAxes;
  const on = await runPass(args, { rerankOff: args.rerank === "off", tag: args.tag, protectedPaths, axesCfg });
  if (!baselines) return;

  // #358 list diff + #392 golden-set hash run beside each tier's own gate, vs the same baseline
  const withList = (r: GateResult, cur: EvalReport, base: EvalReport, tier: "on" | "fusionOnly") => {
    let out = goldenTiers.includes(tier) ? mergeGates(r, evaluateGoldenSet(cur, base, tier)) : r;
    if (listDiff)
      out = mergeGates(out, evaluateListDiff(cur, base, { tier, topK: listDiff.topK, allow: listDiff.allow }));
    return out;
  };

  const onResult = withList(evaluateGate(on.report, baselines.on, thresholds), on.report, baselines.on, "on");
  const sections = [`== ON pass (rerank on) vs ${thresholds.baselineReport} ==\n${renderGate(onResult)}`];
  let pass = onResult.pass;

  // #356: the reranker re-sorts the whole fixture, so fusion is gated on its own OFF pass
  const fusion = thresholds.fusionOnly;
  if (fusion && baselines.off) {
    process.stdout.write("\n");
    const tag = [args.tag, "rerankoff"].filter(Boolean).join("-");
    const off = await runPass(args, { rerankOff: true, tag, protectedPaths, axesCfg });
    // #363 ablation axis (report-only): needs both passes, so it prints here
    process.stdout.write(`\n${ablationMatrix(on.report, off.report).join("\n")}\n`);
    const offResult = withList(
      evaluateFusionOnlyGate(off.report, baselines.off, fusion),
      off.report,
      baselines.off,
      "fusionOnly",
    );
    sections.push(`== OFF pass (fusion-only, rerank off) vs ${fusion.baselineReport} ==\n${renderGate(offResult)}`);
    pass &&= offResult.pass;
  }

  process.stdout.write(`\n${sections.join("\n\n")}\n\nOVERALL GATE: ${pass ? "PASS" : "FAIL"}\n`);
  if (!pass) process.exit(1);
}
