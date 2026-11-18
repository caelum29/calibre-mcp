// Keyword-planner measurement (#651), read-only on an index directory: the document-frequency share
// of every token of a judged query set per chunk_fts column, what each candidate pruning threshold
// would drop, and (with --timing) the library-scope keyword-half time before and after pruning.
// --wired (wiring step, exclusive machine token): only the wired keyword half's time per stage,
// today's MATCH vs the store's planned one (keywordMatch), in alternating rows; nothing else runs.
// Run: CALIBRE_MCP_INDEX_DIR=<dir> node --import tsx scripts/keyword-plan-measure.ts <queries.json> <outDir>
//      [--thresholds 0.05,0.1,0.2] [--timing] [--timed 0.5,0.2] [--limit N] [--wired [--runs 3]]

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type KeywordPlan, type KeywordToken, planKeywordQuery } from "../src/domain/search/keyword-plan.js";
import { stemmedTokens } from "../src/semantic/stem.js";
import { WEIGHTED_BM25, ftsMatch, keywordMatch } from "../src/semantic/store/shared.js";
import { indexFileName, openReadOnlyIndex } from "../src/semantic/store/schema.js";
import { fts5TermStats, type Fts5TermStats } from "../src/semantic/store/term-stats.js";

interface Query {
  id: string;
  category: string;
  library: string;
  scope: "library" | "book";
  query: string;
}

const [queriesPath, outDir, ...rest] = process.argv.slice(2);
const indexDir = process.env.CALIBRE_MCP_INDEX_DIR;
if (!queriesPath || !outDir || !indexDir) {
  process.stderr.write(
    "usage: CALIBRE_MCP_INDEX_DIR=<dir> node --import tsx scripts/keyword-plan-measure.ts <queries.json> <outDir> [--thresholds a,b] [--timing] [--limit N]\n",
  );
  process.exit(2);
}
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const thresholds = (flag("--thresholds") ?? "0.02,0.05,0.1,0.15,0.2,0.3,0.35,0.4,0.5").split(",").map(Number);
// timed arms are a subset: each arm is one more unfiltered library MATCH per query
const timedThresholds = (flag("--timed") ?? "0.5,0.35,0.2,0.1").split(",").map(Number);
const timing = rest.includes("--timing");
const limit = Number(flag("--limit") ?? Infinity);
const queries = (JSON.parse(readFileSync(queriesPath, "utf8")) as Query[]).slice(0, limit);
mkdirSync(outDir, { recursive: true });

const dbs = new Map<string, { db: DatabaseSync; stats: Fts5TermStats }>();
const open = (lib: string) => {
  let e = dbs.get(lib);
  if (!e) {
    const db = openReadOnlyIndex(join(indexDir, indexFileName(lib)));
    e = { db, stats: fts5TermStats(db) };
    dbs.set(lib, e);
  }
  return e;
};

if (rest.includes("--wired")) {
  wiredTiming(Number(flag("--runs") ?? 3));
  for (const { db } of dbs.values()) db.close();
  process.exit(0);
}

/**
 * The wired keyword half, per stage: `plan` = keywordMatch over the library's term statistics
 * (fresh statistics per row, so a row's first plan of a stem pays its vocab lookup = cold; a
 * second plan right after = warm), `sql` = the unfiltered library branch of searchLibraryFts with
 * its production columns (c.body included), pool 200. Rows alternate base/wired (ABBA); each row
 * records the 1-minute load at start and end and is not started above load 8.
 */
function wiredTiming(runs: number): void {
  const sql = `SELECT c.id AS chunk_id, c.book_id, c.char_start, c.char_end, c.body, c.matter_kind, ${WEIGHTED_BM25} AS score
               FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
               WHERE chunk_fts MATCH ? ORDER BY score, c.book_id, c.id LIMIT 200`;
  const lib = queries.filter((x) => x.scope === "library");
  const rowsPath = join(outDir as string, "wired-timing.tsv");
  const loadsPath = join(outDir as string, "wired-rows.tsv");
  writeFileSync(rowsPath, "row\tarm\tquery\tplanColdMs\tplanWarmMs\tsqlMs\tterms\tmatch\n");
  writeFileSync(loadsPath, "row\tarm\tstartUtc\tloadStart\tendUtc\tloadEnd\twallS\n");
  const load1 = () => loadavg()[0] ?? 0;
  const arms = [
    "warmup",
    ...Array.from({ length: runs }, (_, r) => (r % 2 === 0 ? ["base", "wired"] : ["wired", "base"])).flat(),
  ];
  for (const [row, arm] of arms.entries()) {
    const l0 = load1();
    if (l0 > 8) {
      process.stderr.write(`row ${row} (${arm}) not started: load ${l0.toFixed(2)} > 8\n`);
      process.exit(3);
    }
    const t0 = new Date();
    // fresh statistics per wired row: its plan times include the vocab lookups a new session pays
    const fresh = new Map<string, Fts5TermStats>();
    for (const [i, x] of lib.entries()) {
      const { db } = open(x.library);
      let stats = fresh.get(x.library);
      if (!stats) fresh.set(x.library, (stats = fts5TermStats(db)));
      let planCold = 0;
      let planWarm = 0;
      let match: string;
      if (arm === "wired") {
        const a = performance.now();
        match = keywordMatch(x.query, stats).match ?? "";
        planCold = performance.now() - a;
        const b = performance.now();
        keywordMatch(x.query, stats);
        planWarm = performance.now() - b;
      } else {
        match = ftsMatch(x.query) ?? "";
      }
      const c = performance.now();
      db.prepare(sql).all(match);
      const sqlMs = performance.now() - c;
      appendFileSync(
        rowsPath,
        [
          row,
          arm,
          x.id,
          planCold.toFixed(1),
          planWarm.toFixed(1),
          sqlMs.toFixed(1),
          match.split(" OR ").length,
          match,
        ].join("\t") + "\n",
      );
      process.stderr.write(`[row ${row} ${arm} ${i + 1}/${lib.length}] ${x.id} ${sqlMs.toFixed(0)} ms\n`);
    }
    const t1 = new Date();
    appendFileSync(
      loadsPath,
      [
        row,
        arm,
        t0.toISOString(),
        l0.toFixed(2),
        t1.toISOString(),
        load1().toFixed(2),
        ((+t1 - +t0) / 1000).toFixed(0),
      ].join("\t") + "\n",
    );
  }
  process.stderr.write(`wrote wired-timing.tsv + wired-rows.tsv to ${outDir}\n`);
}

// same word tokenizer as stemText, so stems equal what the index stores in body_stem
const tokensOf = (q: string): KeywordToken[] =>
  [...stemmedTokens(q)].map((t) => ({ stem: t.stem, raw: q.slice(t.index, t.index + t.length).toLowerCase() }));
const isCyr = (s: string) => /\p{Script=Cyrillic}/u.test(s);

// ---- 1. per-token document-frequency shares -------------------------------------------------
const tokenRows: string[] = [
  "query\tcategory\tlibrary\traw\tstem\tlang\tshare_body_stem\tshare_body_raw\tshare_book_meta",
];
const shares: Array<{ lib: string; lang: string; stem: string; share: number }> = [];
for (const q of queries) {
  const { stats } = open(q.library);
  const N = stats.totalDocs;
  for (const t of tokensOf(q.query)) {
    const s = stats.docFreq(t.stem, "body_stem") / N;
    const lang = isCyr(t.raw) ? "cyr" : "lat";
    shares.push({ lib: q.library, lang, stem: t.stem, share: s });
    tokenRows.push(
      [
        q.id,
        q.category,
        q.library,
        t.raw,
        t.stem,
        lang,
        s.toFixed(5),
        (stats.docFreq(t.raw, "body") / N).toFixed(5),
        (stats.docFreq(t.stem, "book_meta") / N).toFixed(5),
      ].join("\t"),
    );
  }
}
writeFileSync(join(outDir, "token-shares.tsv"), tokenRows.join("\n") + "\n");

// ---- 2. what each threshold would prune -----------------------------------------------------
const plans = new Map<string, Map<number, KeywordPlan>>();
const thrRows: string[] = [
  "| threshold | token occurrences pruned | distinct stems pruned | queries touched | queries rescued by the never-empty guard | pruned stems (by share, desc) |",
  "|---|---|---|---|---|---|",
];
const occurrences = shares.length;
for (const thr of thresholds) {
  let occ = 0;
  let touched = 0;
  let rescued = 0;
  const stems = new Map<string, number>();
  for (const q of queries) {
    const { stats } = open(q.library);
    const toks = tokensOf(q.query);
    const p = planKeywordQuery(toks, stats, { maxDocShare: thr, bigrams: false });
    let m = plans.get(q.id);
    if (!m) plans.set(q.id, (m = new Map()));
    m.set(thr, p);
    const tooCommon = new Set(p.dropped.filter((d) => d.reason === "too-common").map((d) => d.term));
    occ += toks.filter((t) => tooCommon.has(t.stem)).length;
    if (tooCommon.size > 0) touched++;
    const distinct = new Set(toks.map((t) => t.stem));
    const allOver =
      distinct.size > 1 && [...distinct].every((s) => stats.docFreq(s, "body_stem") / stats.totalDocs > thr);
    if (allOver) rescued++;
    // a stem's share is per library: tag the minority libraries so one list never mixes corpora
    const tag = q.library === "Programming_Books" ? "" : `@${q.library}`;
    for (const s of tooCommon) stems.set(`${s}${tag}`, stats.docFreq(s, "body_stem") / stats.totalDocs);
  }
  const list = [...stems.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, v]) => `${s} ${(v * 100).toFixed(1)}%`)
    .join(", ");
  thrRows.push(
    `| ${thr} | ${occ} / ${occurrences} (${((occ / occurrences) * 100).toFixed(1)}%) | ${stems.size} | ${touched} / ${queries.length} | ${rescued} | ${list} |`,
  );
}

// share distribution per library and script (quantiles of token occurrences)
const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;
const distRows = ["| library | script | tokens | p50 | p75 | p90 | p95 | max |", "|---|---|---|---|---|---|---|---|"];
for (const lib of new Set(shares.map((s) => s.lib))) {
  for (const lang of ["lat", "cyr"]) {
    const xs = shares
      .filter((s) => s.lib === lib && s.lang === lang)
      .map((s) => s.share)
      .sort((a, b) => a - b);
    if (xs.length === 0) continue;
    const f = (v: number) => `${(v * 100).toFixed(2)}%`;
    distRows.push(
      `| ${lib} | ${lang} | ${xs.length} | ${f(q(xs, 0.5))} | ${f(q(xs, 0.75))} | ${f(q(xs, 0.9))} | ${f(q(xs, 0.95))} | ${f(xs.at(-1) ?? 0)} |`,
    );
  }
}
const totals = [...dbs.entries()].map(([lib, e]) => `${lib} ${e.stats.totalDocs} chunks`).join(", ");
writeFileSync(
  join(outDir, "thresholds.md"),
  `# Keyword planner thresholds (#651)\n\nIndex: ${indexDir} (${totals}). Queries: ${queriesPath} (${queries.length}).\n` +
    `Share = document frequency in body_stem / chunks in that library's index.\n\n## Share distribution (token occurrences)\n\n${distRows.join("\n")}\n\n` +
    `## What each threshold prunes (dedupe always on)\n\n${thrRows.join("\n")}\n`,
);
process.stderr.write(`wrote token-shares.tsv + thresholds.md to ${outDir}\n`);

// ---- 3. keyword-half timing (needs the exclusive machine token) ----------------------------
if (timing) {
  const phrase = (t: string) => `"${t.replace(/"/g, '""')}"`;
  // the identifier extras ftsMatch adds after the stems (#634) stay in every arm
  const extrasOf = (query: string, stemCount: number) => (ftsMatch(query) ?? "").split(" OR ").slice(stemCount);
  // the unfiltered library branch of searchLibraryFts, pool = max(k*20, 200) at k=10
  const sql = `SELECT c.id AS chunk_id, c.book_id, ${WEIGHTED_BM25} AS score
               FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
               WHERE chunk_fts MATCH ? ORDER BY score, c.book_id, c.id LIMIT 200`;
  const arms = ["baseline", "dedupe", ...timedThresholds.map(String)];
  const lib = queries.filter((x) => x.scope === "library");
  const ms: Record<string, number[]> = Object.fromEntries(arms.map((a) => [a, []]));
  const rows = ["query\tarm\tms\tterms\tmatch"];
  for (const [i, x] of lib.entries()) {
    const { db } = open(x.library);
    const stmt = db.prepare(sql);
    const toks = tokensOf(x.query);
    const extras = extrasOf(x.query, toks.length);
    const matchOf = (arm: string): string => {
      if (arm === "baseline") return ftsMatch(x.query) ?? "";
      const maxDocShare = arm === "dedupe" ? Infinity : Number(arm);
      const p = planKeywordQuery(toks, open(x.library).stats, { maxDocShare, bigrams: false });
      return [...p.terms.map(phrase), ...extras].join(" OR ");
    };
    stmt.all(matchOf("baseline")); // warm the page cache for this query's posting lists
    // rotate arm order per query so no arm always runs first on a cold list
    const order = arms.map((_, j) => arms[(j + i) % arms.length] as string);
    for (const arm of order) {
      const match = matchOf(arm);
      const t0 = performance.now();
      stmt.all(match);
      const dt = performance.now() - t0;
      ms[arm]?.push(dt);
      rows.push([x.id, arm, dt.toFixed(1), match.split(" OR ").length, match].join("\t"));
    }
    process.stderr.write(`[${i + 1}/${lib.length}] ${x.id}\n`);
  }
  writeFileSync(join(outDir, "timing.tsv"), rows.join("\n") + "\n");
  const sorted = (a: number[]) => [...a].sort((p, r) => p - r);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const tRows = ["| arm | queries | mean ms | p50 | p90 | max | total s |", "|---|---|---|---|---|---|---|"];
  for (const arm of arms) {
    const a = sorted(ms[arm] ?? []);
    tRows.push(
      `| ${arm} | ${a.length} | ${(sum(a) / a.length).toFixed(0)} | ${q(a, 0.5).toFixed(0)} | ${q(a, 0.9).toFixed(0)} | ${(a.at(-1) ?? 0).toFixed(0)} | ${(sum(a) / 1000).toFixed(1)} |`,
    );
  }
  writeFileSync(
    join(outDir, "timing.md"),
    `# Library-scope keyword-half time (#651)\n\nIndex: ${indexDir}. ${lib.length} library-scope queries; one warm-up run of the baseline MATCH per query, then each arm once in rotated order. SQL = the unfiltered branch of searchLibraryFts (pool 200). Arms: baseline = production ftsMatch; dedupe = distinct stems only; a number = dedupe + prune above that share. Identifier extras (#634) kept in every arm.\n\n${tRows.join("\n")}\n`,
  );
  process.stderr.write(`wrote timing.tsv + timing.md to ${outDir}\n`);
}
for (const { db } of dbs.values()) db.close();
