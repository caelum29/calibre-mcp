// Deep judged dump for #649 / #619: one hybrid calibre_semantic_search call per judged query at
// topK 50 and debug level, so every fused candidate down to rank 50 carries its cosine, rerank
// score and #650 provenance. Read-only on the library and index; it loads both models (model token).
// Run: CALIBRE_MCP_INDEX_DIR=<snapshot> node --import tsx scripts/pool-dump.ts <runDir>
//      [--scope book|library] [--ids a,b] [--top-k 50]
// (runDir holds a frozen queries.json; writes pool-hits.jsonl, resumable, and pool-meta.json).
// Queries run one at a time: parallel semantic calls compete for the CPU and skip the rerank.

import { execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../src/server.js";
import { toRawRun, type JudgedQuery, type RawRecord } from "./judged-lib.js";

const [runDir, ...rest] = process.argv.slice(2);
if (!runDir) {
  process.stderr.write("usage: pool-dump.ts <runDir> [--scope book|library] [--ids a,b] [--top-k 50]\n");
  process.exit(2);
}
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const scope = flag("--scope");
const ids = flag("--ids")?.split(",");
const topK = Number(flag("--top-k") ?? 50);

const queries = (JSON.parse(readFileSync(join(runDir, "queries.json"), "utf8")) as JudgedQuery[]).filter(
  (q) => (!scope || q.scope === scope) && (!ids || ids.includes(q.id)),
);
const outPath = join(runDir, "pool-hits.jsonl");
const done = new Set(
  existsSync(outPath)
    ? readFileSync(outPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as RawRecord).query.id)
    : [],
);

// the wave protocol records the 1-minute load average at the start and end of every dump
const metaPath = join(runDir, "pool-meta.json");
const meta = {
  ...(existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>) : {}),
  gitSha: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
  node: process.version,
  topK,
  indexDir: process.env.CALIBRE_MCP_INDEX_DIR ?? "(default)",
  startedAt: new Date().toISOString(),
  loadStart: loadavg()[0],
};
writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

// debug level adds the #650 provenance and per-stage timings to every result
const env = { CALIBRE_MCP_SERVER_URL: "http://localhost:8080", ...process.env, CALIBRE_MCP_LOG_LEVEL: "debug" };
const server = buildServer({ env });
const client = new Client({ name: "pool-dump", version: "0" });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
await client.connect(clientSide);

try {
  for (const [i, q] of queries.entries()) {
    if (done.has(q.id)) continue;
    const args = {
      query: q.query,
      library: q.library,
      scope: q.scope,
      target: q.target ?? "text",
      mode: "hybrid",
      topK,
      ...(q.scope === "book" && q.bookId !== null && q.bookId !== undefined ? { bookId: q.bookId } : {}),
    };
    const r = await client.callTool({ name: "calibre_semantic_search", arguments: args });
    const text = (r.content as { type: string; text?: string }[])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
    const run = toRawRun(r.structuredContent as Record<string, unknown> | undefined, Boolean(r.isError), text, q);
    const rec: RawRecord = { query: q, runs: { hybrid: run } };
    appendFileSync(outPath, `${JSON.stringify(rec)}\n`);
    process.stderr.write(
      `[${i + 1}/${queries.length}] ${q.id} ${run.isError ? "ERROR" : `${run.hits.length} hits`} ${run.timings?.totalMs ?? "?"} ms\n`,
    );
  }
} finally {
  await Promise.allSettled([client.close(), server.close()]);
  writeFileSync(
    metaPath,
    `${JSON.stringify({ ...meta, finishedAt: new Date().toISOString(), loadEnd: loadavg()[0] }, null, 2)}\n`,
  );
}
