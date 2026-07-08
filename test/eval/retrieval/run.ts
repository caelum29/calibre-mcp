// `pnpm eval` — the golden-query retrieval eval CLI (NOT part of `pnpm test`: it embeds the
// fixture corpus with the real e5 model). Reuses the locally cached model (no re-download),
// builds a fresh fixture index in a work dir, and writes committed md+json reports.
//
// Usage:
//   pnpm eval [--modes hybrid,vector,keyword] [--topk 10] [--tag baseline]
//             [--rerank <label>] [--work-dir <dir>] [--out-dir <dir>] [--live]
//
// Offline path: deterministic — two runs at the same commit produce identical JSON.
// --live: runs library-scope queries against a COPY of the real library index using
//   live-relevance.json labels (UNVERIFIED until Artem confirms). Never touches the
//   production index dir beyond reading; skip in CI.
// --rerank: recorded in report meta + exported as CALIBRE_MCP_RERANK — the seam for the
//   future cross-encoder reranker (prompt 03) to run the eval with reranking on/off.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../src/config.js";
import { ALL_MODES, renderMarkdown, runRetrievalEval, type EvalReport, type Mode } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const progress = (msg: string) => process.stderr.write(`[eval] ${msg}\n`);

interface CliArgs {
  live: boolean;
  modes: Mode[];
  topK: number;
  tag?: string;
  rerank?: string;
  workDir: string;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    live: false,
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
    else if (a === "--modes") args.modes = next().split(",") as Mode[];
    else if (a === "--topk") args.topK = Number(next());
    else if (a === "--tag") args.tag = next();
    else if (a === "--rerank") args.rerank = next();
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  mkdirSync(args.workDir, { recursive: true });
  ensureModelCache(args.workDir);

  let live: LiveRelevance | undefined;
  if (args.live) {
    live = prepareLive(args.workDir);
  } else {
    // Fresh fixture build every run — deterministic and immune to INDEX_VERSION bumps.
    rmSync(path.join(args.workDir, sqliteName("eval_fixture")), { force: true });
  }

  const sha = gitSha();
  const rerank = args.rerank;
  if (rerank !== undefined) process.env.CALIBRE_MCP_RERANK = rerank; // prompt-03 seam

  const report = await runRetrievalEval({
    indexDir: args.workDir,
    modes: args.modes,
    topK: args.topK,
    ...(rerank !== undefined ? { rerank } : {}),
    gitSha: sha,
    ...(live ? { live } : {}),
    onProgress: progress,
  });

  mkdirSync(args.outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const base = [date, sha, args.tag, args.live ? "live" : undefined].filter(Boolean).join("-");
  const jsonPath = path.join(args.outDir, `${base}.json`);
  const mdPath = path.join(args.outDir, `${base}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(mdPath, renderMarkdown(report, base) + "\n");

  progress(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  // CLI summary on stdout (this is a script, not the stdio MCP server).
  process.stdout.write(`${headline(report)}\nreport: ${mdPath}\njson:   ${jsonPath}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`[eval] FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
