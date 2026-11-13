// Blind judged eval, step 1: run every pre-registered query through the real
// calibre_semantic_search (in-process server, same wiring as debug-call.ts) and save the raw
// hits + debug timings, then write blind batch files for separate judge agents.
// Run: pnpm eval:judged:dump <runDir> [--batch 40]   (runDir holds a frozen queries.json) — #602
// Read-only on the library; resumable (queries already in raw-hits.jsonl are skipped).
// Queries run one at a time: parallel semantic calls compete for the same CPU and skip the rerank.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../src/server.js";
import {
  blindRecord,
  KEYWORD_CATEGORIES,
  toRawRun,
  type BlindKey,
  type BlindQuery,
  type JudgedQuery,
  type RawRecord,
} from "./judged-lib.js";

const [runDir, ...rest] = process.argv.slice(2);
if (!runDir) {
  process.stderr.write("usage: pnpm eval:judged:dump <runDir> [--batch 40]\n");
  process.exit(2);
}
const batchFlag = rest.indexOf("--batch");
const batchSize = batchFlag >= 0 ? Number(rest[batchFlag + 1]) : 40;

const queries = JSON.parse(readFileSync(join(runDir, "queries.json"), "utf8")) as JudgedQuery[];
const rawPath = join(runDir, "raw-hits.jsonl");
const readRaw = (): RawRecord[] =>
  existsSync(rawPath)
    ? readFileSync(rawPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RawRecord)
    : [];
const done = new Set(readRaw().map((r) => r.query.id));

// debug log level turns on the per-stage timings in every result
const server = buildServer({
  env: { CALIBRE_MCP_SERVER_URL: "http://localhost:8080", ...process.env, CALIBRE_MCP_LOG_LEVEL: "debug" },
});
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
    ...(q.scope === "book" && q.bookId != null ? { bookId: q.bookId } : {}),
  };
  const r = await client.callTool({ name: "calibre_semantic_search", arguments: args });
  const text = (r.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
  return toRawRun(r.structuredContent as Record<string, unknown> | undefined, Boolean(r.isError), text, q);
}

try {
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

// Blind batches: judges get only query + mustCover + pooled, shuffled, score-free hits.
const blindDir = join(runDir, "blind");
mkdirSync(blindDir, { recursive: true });
const key: BlindKey = {};
const blinds: BlindQuery[] = [];
for (const rec of readRaw()) {
  const b = blindRecord(rec);
  Object.assign(key, b.key);
  blinds.push(b.blind);
}
const batches = Math.ceil(blinds.length / batchSize);
for (let b = 0; b < batches; b++) {
  const name = `batch-${String(b + 1).padStart(2, "0")}.json`;
  writeFileSync(join(blindDir, name), JSON.stringify(blinds.slice(b * batchSize, (b + 1) * batchSize), null, 1));
}
writeFileSync(join(runDir, "blind-key.json"), JSON.stringify(key));
process.stderr.write(`blind: ${blinds.length} queries in ${batches} batch file(s) under ${blindDir}\n`);
