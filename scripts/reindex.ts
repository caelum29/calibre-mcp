// Resumable bulk (re-)index with book-level concurrency (#99) — the #87 orchestrator's
// rebuild phase as a reusable dev script, doubling as the benchmark harness.
// Run: pnpm reindex --index-dir <dir> [--concurrency 3] [--encoder threads|shared] [--ids 1,2,3]
// --flags-only (#269): no model, no re-embed — refresh each indexed book's front-matter flags
// (EPUB TOC / PDF outline) and metadata in place; books whose text changed are reported as failed.
// Resume log: <index-dir>/[flags-]progress-<libraryId>.jsonl per library (#285); --progress <file> overrides.

import { statfsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { log } from "../src/logging.js";
import { ContentServerClient } from "../src/calibre/content-server.js";
import { CalibreClient } from "../src/calibre/client.js";
import { Extractor } from "../src/calibre/extract.js";
import { FigureInventoryService } from "../src/calibre/figure-inventory.js";
import { TransformersEmbedder } from "../src/semantic/embedder.js";
import { inThreadEncoder, type BookEncoder } from "../src/semantic/book-encoder.js";
import { ThreadEncoder } from "../src/semantic/thread-encoder.js";
import { SqliteIndexStore } from "../src/semantic/store.js";
import { runBookPipeline } from "../src/semantic/book-pipeline.js";
import { appendProgress, resolveProgressPath, resumeProgress } from "../src/semantic/build-progress.js";
import { commitBook, commitRefresh, describeError, prepareBook, type PrepareResult } from "../src/tools/index-book.js";
import type { ToolDeps } from "../src/tools/types.js";

const { values: opt } = parseArgs({
  options: {
    "index-dir": { type: "string" },
    production: { type: "boolean", default: false },
    concurrency: { type: "string", default: "3" },
    // shared = every worker on the main thread with one embedder; threads = one worker thread
    // (own embedder) per worker, so chunk+tokenize+embed leave the main thread (#99).
    encoder: { type: "string", default: "threads" },
    progress: { type: "string" },
    ids: { type: "string" },
    library: { type: "string" },
    "skip-fresh": { type: "boolean", default: false },
    "flags-only": { type: "boolean", default: false },
    "min-free-gb": { type: "string", default: "8" },
  },
});

function say(msg: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

const prodConfig = loadConfig({ ...process.env, CALIBRE_MCP_INDEX_DIR: "" });
const prodDir = prodConfig.indexDir;
const indexDir = path.resolve(opt["index-dir"] ?? "");
// A benchmark that writes the production index would wipe hours of build — make it explicit.
if (!opt["index-dir"]) throw new Error("--index-dir is required (use a scratch dir for benchmarks)");
if (indexDir === path.resolve(prodDir) && !opt.production) {
  throw new Error(`${indexDir} is the production index — pass --production to really rebuild it`);
}
const concurrency = Math.max(1, Number(opt.concurrency) || 1);
const flagsOnly = opt["flags-only"];
// A flag backfill never encodes — no worker threads, no model load.
const threaded = opt.encoder === "threads" && !flagsOnly;
const minFreeGb = Number(opt["min-free-gb"]);

const config = loadConfig({ ...process.env, CALIBRE_MCP_INDEX_DIR: indexDir });
// Same JSONL sink as the running servers (#247) — the production logs dir even when
// --index-dir points at a scratch index, so every process's trail lands in one place.
log.configure({ level: prodConfig.logLevel, dir: prodConfig.logDir });
const figures = new FigureInventoryService(config);
const deps = {
  config,
  content: new ContentServerClient(config),
  calibre: new CalibreClient(config),
  extractor: new Extractor(config, figures),
  figures,
  embedder: new TransformersEmbedder(config),
  index: new SqliteIndexStore(config, log),
  log,
} as unknown as ToolDeps;

// shared: one ONNX session (its InferenceQueue serializes forwards) and all chunking on the
// main thread. threads: one model copy per thread — ~+300 MB each, the price of real parallelism.
const threads = threaded ? Array.from({ length: concurrency }, () => new ThreadEncoder(config)) : [];
const encoders: BookEncoder[] = threaded ? threads : [inThreadEncoder(deps.embedder)];
const tWarm = Date.now();
if (!flagsOnly) await Promise.all(threaded ? threads.map((t) => t.warmup()) : [deps.embedder.warmup()]);
const warmupMs = Date.now() - tWarm;

const libraryId = await deps.content.resolveLibraryId(opt.library);
// Default log is per library (book ids overlap across libraries, #285) and per mode (a full
// re-index's "done" ids must not hide books from the flags backfill); --progress overrides.
const progressFile = resolveProgressPath(opt.progress, indexDir, libraryId, flagsOnly);
let ids: number[];
if (opt.ids) {
  ids = opt.ids
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isInteger);
} else {
  const page = await deps.content.search({ query: "", library: opt.library, num: 5000 });
  ids = page.bookIds;
}
const done = resumeProgress(progressFile);
const todo = ids.filter((id) => !done.has(id));
say(
  `${ids.length} selected, ${done.size} already done (${progressFile}), ${todo.length} to index — concurrency ${concurrency}, ${threaded ? "thread-per-worker" : "shared main-thread"} encoder, warmup ${warmupMs} ms`,
);

const freeGb = (): number => {
  const s = statfsSync(indexDir);
  return (s.bavail * s.bsize) / 1024 ** 3;
};

let settled = 0;
let okBooks = 0;
let failed = 0;
let abort = false;
// Summed per-phase wall time over committed books — with N>1 these overlap, so the sum can exceed wallMs.
const phaseTotals = { fetch: 0, extract: 0, chunk: 0, embed: 0 };
const t0 = Date.now();
await runBookPipeline<PrepareResult>(todo, concurrency, {
  prepare: (bookId, worker) => {
    // A full disk mid-write is worse than a pause — the run is resumable from the progress log.
    if (abort) throw new Error("ABORTED_LOW_DISK");
    return prepareBook(deps, bookId, {
      libraryId,
      library: opt.library,
      force: !opt["skip-fresh"],
      keywordOnly: false,
      tokenBudgeted: true,
      encoder: encoders[threaded ? worker : 0],
      flagsOnly,
    });
  },
  commit: (_bookId, prepared) => {
    if (prepared.kind === "ready") commitBook(deps, libraryId, prepared);
    // --skip-fresh after a metadata cleanup: unchanged text refreshes in place (#244).
    else if (prepared.kind === "refreshed") commitRefresh(deps, libraryId, prepared);
  },
  onSettled: (o) => {
    settled++;
    if (o.ok) okBooks++;
    else failed++;
    // Aborted books leave no record, so a resume picks them up.
    if (!o.ok && describeError(o.error) === "ABORTED_LOW_DISK") return;
    const ready = o.ok && o.prepared.kind === "ready" ? o.prepared : undefined;
    const detail = ready ? { ...ready.detail, phaseMs: ready.phaseMs } : {};
    if (ready)
      for (const k of Object.keys(phaseTotals) as Array<keyof typeof phaseTotals>) phaseTotals[k] += ready.phaseMs[k];
    appendProgress(progressFile, {
      bookId: o.bookId,
      ok: o.ok,
      ms: o.ms,
      worker: o.worker,
      ...detail,
      ...(o.ok ? {} : { stage: o.stage, error: describeError(o.error) }),
      at: new Date().toISOString(),
    });
    if (settled % 25 === 0 && freeGb() < minFreeGb) {
      abort = true;
      say(`ABORT: under ${minFreeGb} GiB free — finishing in-flight books, rerun to resume`);
    }
    if (settled % 10 === 0) {
      const avg = (Date.now() - t0) / settled;
      say(
        `progress ${settled}/${todo.length} (${(avg / 1000).toFixed(1)} s/book wall, ~${Math.round(((todo.length - settled) * avg) / 60000)} min left)`,
      );
    }
  },
});
const wallMs = Date.now() - t0;
// maxRSS is this process only (KiB) — extraction subprocesses (ebook-convert, pdftotext) are not in it.
const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
const summary = {
  concurrency,
  encoder: threaded ? "threads" : "shared",
  books: todo.length,
  ok: okBooks,
  failed,
  wallMs,
  sPerBook: todo.length ? Number((wallMs / 1000 / todo.length).toFixed(2)) : 0,
  warmupMs,
  peakRssMb,
  phaseTotalsS: Object.fromEntries(Object.entries(phaseTotals).map(([k, v]) => [k, Math.round(v / 1000)])),
};
say(`done: ${JSON.stringify(summary)}`);
process.stdout.write(JSON.stringify(summary) + "\n");
await Promise.all(threads.map((t) => t.close()));
process.exit(abort ? 2 : 0);
