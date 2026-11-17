// #620 spike (never merged): restrict judged arm runs to the landing queries, so
// `pnpm eval:judged:compare` pools exactly them. Landing = every Programming_Books query with an
// expected book in the subset, or a subset book graded relevant (≥ 1) in arm 0's top 5.
// Writes <out>/<run>-landing/ (queries.json, raw-hits.jsonl, blind-key.json, blind/, judgements/)
// per run and a private store named for the landing query set (records copied from the shared store).
// Run: node --import tsx scripts/spike620-landing.ts --subset <subset.json> --store <shared.jsonl> --out <dir> <arm0Dir> [<armDir> …]

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import type { JudgedQuery, RawRecord } from "./judged-lib.js";
import { gradeFromStore, pooledHits, readStore, storeFileName } from "./judged-store.js";

const { values: opt, positionals: runs } = parseArgs({
  options: { subset: { type: "string" }, store: { type: "string" }, out: { type: "string" } },
  allowPositionals: true,
});
if (!opt.subset || !opt.store || !opt.out || runs.length === 0) throw new Error("usage: see file header");

const subset = new Set((JSON.parse(readFileSync(opt.subset, "utf8")) as { ids: number[] }).ids);
const store = readStore(opt.store);
const rawsOf = (dir: string): RawRecord[] =>
  readFileSync(join(dir, "raw-hits.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RawRecord);

// Landing set from arm 0 (the first run dir).
const arm0 = rawsOf(runs[0]!);
const grades = gradeFromStore(arm0, store);
const landing = new Set<string>();
const why: Record<string, string> = {};
for (const rec of arm0) {
  const q = rec.query;
  if (q.library !== "Programming_Books") continue;
  if (q.expectedBooks.some((e) => subset.has(e.id))) {
    landing.add(q.id);
    why[q.id] = "expected book in subset";
    continue;
  }
  // hybrid top 5 only (rank ≤ 5); pooled ids are what the store grades
  const relevant = pooledHits(rec).find(
    (p) => p.rank <= 5 && p.location && subset.has(p.location.bookId) && (grades.get(p.hid)?.grade ?? 0) >= 1,
  );
  if (relevant) {
    landing.add(q.id);
    why[q.id] = `subset book ${relevant.location!.bookId} graded relevant in arm 0`;
  }
}

const allQueries = JSON.parse(readFileSync(join(runs[0]!, "queries.json"), "utf8")) as JudgedQuery[];
const landingJson = JSON.stringify(
  allQueries.filter((q) => landing.has(q.id)),
  null,
  2,
);
mkdirSync(opt.out, { recursive: true });
const privateStore = join(opt.out, storeFileName(landingJson));
writeFileSync(
  privateStore,
  store
    .filter((r) => landing.has(r.qid))
    .map((r) => `${JSON.stringify(r)}\n`)
    .join(""),
);

for (const dir of runs) {
  const dest = join(opt.out, `${basename(dir)}-landing`);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "queries.json"), landingJson);
  const kept = rawsOf(dir).filter((r) => landing.has(r.query.id));
  writeFileSync(join(dest, "raw-hits.jsonl"), kept.map((r) => `${JSON.stringify(r)}\n`).join(""));
  for (const f of ["blind-key.json", "book-lengths.json"])
    if (existsSync(join(dir, f))) cpSync(join(dir, f), join(dest, f));
  for (const d of ["blind", "judgements"])
    if (existsSync(join(dir, d))) cpSync(join(dir, d), join(dest, d), { recursive: true });
}
writeFileSync(
  join(opt.out, "landing.json"),
  JSON.stringify({ count: landing.size, privateStore, queries: why }, null, 1) + "\n",
);
process.stderr.write(`${landing.size} landing queries; private store ${privateStore}\n`);
