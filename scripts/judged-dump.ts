// Blind judged eval, step 1: run every pre-registered query through the real
// calibre_semantic_search (in-process server, same wiring as debug-call.ts) and save the raw
// hits + debug timings, then write blind batch files for separate judge agents.
// Run: pnpm eval:judged:dump <runDir> [--batch 40] [--store <file>] [--strict-text] [--arm <name>]
// (runDir holds a frozen queries.json) — #602. With --store, the blind batches hold only the hits no
// stored judgment covers (incremental pooling, #361); the key still maps every pooled item.
// --arm <name>: one pre-registered #644 rerank latency arm (thresholds.rerankLatency.arms); its
// rerank options reach retrieve() through BuildServerOptions.retrievalOptions, arm.json records
// them in the run dir, and 3 warm-up queries outside the judged set run first (discarded).
// Read-only on the library; resumable (queries already in raw-hits.jsonl are skipped).
// Queries run one at a time: parallel semantic calls compete for the same CPU and skip the rerank.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { execSync } from "node:child_process";
import { buildServer } from "../src/server.js";
import { rerankLatencyArms } from "../test/eval/retrieval/gate-guards.js";
import type { Thresholds } from "../test/eval/retrieval/gate.js";
import { KEYWORD_CATEGORIES, toRawRun, type JudgedQuery, type RawRecord } from "./judged-lib.js";
import { readBookLengths } from "./judged-lengths.js";
import { readStore, storePathError, uncoveredBlind } from "./judged-store.js";
import { loadRuntimeConfig } from "../src/runtime-config.js";

const [runDir, ...rest] = process.argv.slice(2);
if (!runDir) {
  process.stderr.write(
    "usage: pnpm eval:judged:dump <runDir> [--batch 40] [--store <file>] [--strict-text] [--arm <name>]\n",
  );
  process.exit(2);
}
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const batchSize = Number(flag("--batch") ?? 40);
const storeFile = flag("--store");
const strictText = rest.includes("--strict-text");
const armName = flag("--arm");

const queriesJson = readFileSync(join(runDir, "queries.json"), "utf8");
const pathError = storeFile && storePathError(storeFile, queriesJson);
if (pathError) {
  process.stderr.write(`${pathError}\n`);
  process.exit(2);
}
const queries = JSON.parse(queriesJson) as JudgedQuery[];
const rawPath = join(runDir, "raw-hits.jsonl");
const readRaw = (): RawRecord[] =>
  existsSync(rawPath)
    ? readFileSync(rawPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RawRecord)
    : [];
const done = new Set(readRaw().map((r) => r.query.id));

// #644: the arm comes from the committed, pre-registered block — never typed options — so every
// row's options are the ones declared before any arm was dumped
const armPath = join(runDir, "arm.json");
const thresholdsPath = join(import.meta.dirname, "../test/eval/retrieval/thresholds.json");
const arm = armName
  ? rerankLatencyArms(JSON.parse(readFileSync(thresholdsPath, "utf8")) as Thresholds).get(armName)
  : undefined;
if (armName && !arm) {
  process.stderr.write(`unknown --arm "${armName}" (not in thresholds.rerankLatency.arms)\n`);
  process.exit(2);
}
// a resumed run dir must keep its arm: mixing two arms' hits in one raw-hits.jsonl is unrecoverable
const priorArm = existsSync(armPath) ? (JSON.parse(readFileSync(armPath, "utf8")) as { name: string }).name : undefined;
if (priorArm !== armName && (priorArm !== undefined || done.size > 0)) {
  process.stderr.write(
    `run dir holds arm "${priorArm ?? "(none)"}", not "${armName ?? "(none)"}": use a fresh run dir\n`,
  );
  process.exit(2);
}
if (arm && priorArm === undefined) {
  const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const record = { name: armName, ...arm, gitSha: sha, node: process.version, startedAt: new Date().toISOString() };
  writeFileSync(armPath, `${JSON.stringify(record, null, 2)}\n`);
}

// debug log level turns on the per-stage timings in every result
const env = { CALIBRE_MCP_SERVER_URL: "http://localhost:8080", ...process.env, CALIBRE_MCP_LOG_LEVEL: "debug" };
const server = buildServer({ env, ...(arm ? { retrievalOptions: arm.options } : {}) });
const client = new Client({ name: "judged-dump", version: "0" });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
await client.connect(clientSide);

/** One tool call for one query in one mode. */
async function search(q: JudgedQuery, mode: "hybrid" | "keyword", topK: number) {
  const args = {
    query: q.query,
    library: q.library,
    scope: q.scope,
    target: q.target ?? "text",
    mode,
    topK,
    ...(q.scope === "book" && q.bookId !== null && q.bookId !== undefined ? { bookId: q.bookId } : {}),
  };
  const r = await client.callTool({ name: "calibre_semantic_search", arguments: args });
  const text = (r.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
  return toRawRun(r.structuredContent as Record<string, unknown> | undefined, Boolean(r.isError), text, q);
}

// #644 protocol: warm-up queries outside the judged set load both models and build the candidate
// cache before the timed queries; their results are discarded
const WARMUP_QUERIES = [
  "how a garbage collector decides which objects to free",
  "что такое замыкание в программировании",
  "trade-offs between consistency and availability in distributed systems",
];

try {
  if (arm && done.size === 0 && queries.length > 0) {
    // the most-queried library, so the warm-up builds the candidate cache the timed queries read
    const counts = new Map<string, number>();
    for (const q of queries) counts.set(q.library, (counts.get(q.library) ?? 0) + 1);
    const library = [...counts].sort((x, y) => y[1] - x[1])[0]![0];
    for (const query of WARMUP_QUERIES) {
      const w: JudgedQuery = {
        ...queries[0]!,
        id: "warmup",
        library,
        query,
        scope: "library",
        bookId: null,
        target: "text",
      };
      const r = await search(w, "hybrid", 5);
      process.stderr.write(`[warm-up] ${r.timings?.totalMs ?? "?"} ms\n`);
    }
  }
  for (const [i, q] of queries.entries()) {
    if (done.has(q.id)) continue;
    const rec: RawRecord = { query: q, runs: { hybrid: await search(q, "hybrid", 5) } };
    if (KEYWORD_CATEGORIES.has(q.category)) rec.runs.keyword = await search(q, "keyword", 3);
    appendFileSync(rawPath, `${JSON.stringify(rec)}\n`);
    const h = rec.runs.hybrid!;
    process.stderr.write(
      `[${i + 1}/${queries.length}] ${q.id} ${h.isError ? "ERROR" : `${h.hits.length} hits`} ${h.timings?.totalMs ?? "?"} ms\n`,
    );
  }
} finally {
  await Promise.allSettled([client.close(), server.close()]);
}

// Chunks per book of every queried library (read-only from the index): the score report's length quartiles
const libraries = [...new Set(queries.map((q) => q.library))];
writeFileSync(
  join(runDir, "book-lengths.json"),
  JSON.stringify(readBookLengths(loadRuntimeConfig(env).indexDir, libraries)),
);

// Blind batches: judges get only query + mustCover + pooled, shuffled, score-free hits — with a store,
// only the hits it does not cover yet. Old batch files go first, so judges never re-grade a stale one.
const blindDir = join(runDir, "blind");
mkdirSync(blindDir, { recursive: true });
for (const f of readdirSync(blindDir).filter((n) => /^batch-\d+\.json$/.test(n))) rmSync(join(blindDir, f));
const { blinds, key } = uncoveredBlind(readRaw(), storeFile ? readStore(storeFile) : [], { strictText });
const batches = Math.ceil(blinds.length / batchSize);
for (let b = 0; b < batches; b++) {
  const name = `batch-${String(b + 1).padStart(2, "0")}.json`;
  writeFileSync(join(blindDir, name), JSON.stringify(blinds.slice(b * batchSize, (b + 1) * batchSize), null, 1));
}
writeFileSync(join(runDir, "blind-key.json"), JSON.stringify(key));
const items = blinds.reduce((n, b) => n + b.items.length, 0);
process.stderr.write(
  `blind: ${items} item(s) of ${blinds.length} queries in ${batches} batch file(s) under ${blindDir}` +
    (storeFile ? ` (${Object.keys(key).length - items} pooled item(s) already in the store)` : "") +
    "\n",
);
