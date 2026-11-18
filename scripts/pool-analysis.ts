// Read-only analysis of judged dumps for two retrieval questions, reported under the rules posted
// on the issues before any count: `admission` counts #649's rerank admission misses, and `blend`
// fits #619's rerank/cosine blend α by leave-one-out. Grades come from the judgment store only;
// --judge-dir writes the still-unjudged hits as blind batches for the judged-blind Workflow.
// Run: node --import tsx scripts/pool-analysis.ts admission --store <file> [--base <runDir>]
//        [--pool <runDir>] [--n 5] [--judge-dir <dir>] [--out <file.md>]
//      node --import tsx scripts/pool-analysis.ts blend --pool <runDir> --store <file>
//        [--base <runDir>] [--judge-dir <dir>] [--out <file.md>] [--json <file.json>]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crossValidate, leaveOneOut } from "../test/eval/retrieval/folds.js";
import { mean, sampleSd } from "../test/eval/retrieval/stats.js";
import type { RawHit, RawRecord } from "./judged-lib.js";
import { readStore, type StoredJudgment } from "./judged-store.js";
import {
  admissionCandidates,
  fitAlpha,
  gradeList,
  hitAndRr,
  orderPool,
  productionPool,
  provenanceOf,
  writeJudgeDir,
  type PoolOrder,
} from "./pool-analysis-lib.js";

const [cmd, ...argv] = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const storeFile = flag("--store");
if ((cmd !== "admission" && cmd !== "blend") || !storeFile) {
  process.stderr.write("usage: pool-analysis.ts admission|blend --store <file> [--base <dir>] [--pool <dir>] …\n");
  process.exit(2);
}
const store = readStore(storeFile);
const readJsonl = (file: string): RawRecord[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RawRecord);
const baseDir = flag("--base");
const poolDir = flag("--pool");
const base = baseDir ? readJsonl(join(baseDir, "raw-hits.jsonl")) : [];
const deep = poolDir ? readJsonl(join(poolDir, "pool-hits.jsonl")) : [];
const deepTopK = poolDir
  ? ((JSON.parse(readFileSync(join(poolDir, "pool-meta.json"), "utf8")) as { topK?: number }).topK ?? 50)
  : 50;
// the judge dir must carry the store's query set verbatim, so new grades land in the same store
const queriesJson = (): string => {
  const dir = poolDir ?? baseDir;
  if (!dir || !existsSync(join(dir, "queries.json")))
    throw new Error("--judge-dir needs queries.json in --pool or --base");
  return readFileSync(join(dir, "queries.json"), "utf8");
};
const out: string[] = [];
const say = (line = "") => out.push(line);
const loc = (h: RawHit) => `${h.bookId}@${h.at}`;
const gradeText = (g: number | null | undefined) => (g === null || g === undefined ? "unjudged" : String(g));
const fmt = (x: number) => x.toFixed(3);

/** #649: candidates from the top-5 base dump and (if given) the deep dump, graded from the store. */
function admission(): void {
  const judgeN = Number(flag("--n") ?? 5);
  const store0: readonly StoredJudgment[] = store;
  say(`# #649 admission misses (store ${storeFile})`);
  say();
  say("Rule: issue comment, 2026-11-18. Relevant = store grade 2. Corpus: live library via the wave snapshot.");
  if (base.length) {
    say();
    say(`## Base dump (${baseDir}, n = ${base.length} queries): returned top-5 hits not scored by the rerank`);
    say();
    say("| query | category | book | half | vR | kR | fR | grade |");
    say("|---|---|---|---|---|---|---|---|");
    let rows = 0;
    let noProv = 0;
    for (const rec of base) {
      const hits = rec.runs.hybrid?.hits ?? [];
      if (hits.length && !hits.some((h) => provenanceOf(h))) noProv++;
      const grades = gradeList(rec, hits, store0);
      hits.forEach((h, i) => {
        const p = provenanceOf(h);
        if (!p || p.rerankPool) return;
        const inV = (p.vectorRank ?? Infinity) <= 10;
        const inK = (p.keywordRank ?? Infinity) <= 10;
        if (!inV && !inK) return;
        rows++;
        say(
          `| ${rec.query.id} | ${rec.query.category} | ${h.bookId} | ${inV && inK ? "both" : inV ? "vector" : "keyword"} | ${p.vectorRank ?? "–"} | ${p.keywordRank ?? "–"} | ${p.fusedRank ?? "–"} | ${gradeText(grades[i])} |`,
        );
      });
    }
    say();
    say(`${rows} row(s) (half rank ≤ 10). Queries whose hits carry no provenance: ${noProv}.`);
  }
  if (!deep.length) return;
  const judge: RawRecord[] = [];
  for (const n of [5, 10]) {
    say();
    say(`## Deep dump (${poolDir}, topK ${deepTopK}), N = ${n}${n === 5 ? " (decides)" : " (information only)"}`);
    say();
    say("| query | category | book | half | vR | kR | fR | grade | title |");
    say("|---|---|---|---|---|---|---|---|---|");
    const perCat = new Map<
      string,
      { queries: number; misses: number; withMiss: number; unjudged: number; unclassified: number }
    >();
    for (const rec of deep) {
      const hits = rec.runs.hybrid?.hits ?? [];
      const { candidates, unclassified } = admissionCandidates(hits, n, deepTopK);
      const grades = gradeList(
        rec,
        candidates.map((c) => c.hit),
        store0,
        candidates.length,
      );
      const c = perCat.get(rec.query.category) ?? { queries: 0, misses: 0, withMiss: 0, unjudged: 0, unclassified: 0 };
      c.queries++;
      let misses = 0;
      candidates.forEach((cand, i) => {
        const g = grades[i];
        if (g === null) c.unjudged++;
        if (g === 2) misses++;
        if (g === 2 || g === 1 || g === null)
          say(
            `| ${rec.query.id} | ${rec.query.category} | ${cand.hit.bookId} | ${cand.half} | ${cand.vectorRank ?? "–"} | ${cand.keywordRank ?? "–"} | ${cand.fusedRank ?? "–"} | ${gradeText(g)} | ${cand.hit.title.slice(0, 60)} |`,
          );
      });
      c.misses += misses;
      if (misses) c.withMiss++;
      c.unclassified += unclassified.length;
      perCat.set(rec.query.category, c);
      if (n === judgeN && candidates.length) {
        judge.push({ query: rec.query, runs: { hybrid: { ...rec.runs.hybrid!, hits: candidates.map((x) => x.hit) } } });
      }
    }
    say();
    say(
      "| category | n queries | admission misses (grade 2) | queries with ≥ 1 | unjudged candidates | unclassified half ranks |",
    );
    say("|---|---|---|---|---|---|");
    const all = { queries: 0, misses: 0, withMiss: 0, unjudged: 0, unclassified: 0 };
    for (const [cat, c] of [...perCat].sort(([a], [b]) => a.localeCompare(b))) {
      say(`| ${cat} | ${c.queries} | ${c.misses} | ${c.withMiss} | ${c.unjudged} | ${c.unclassified} |`);
      for (const k of Object.keys(all) as Array<keyof typeof all>) all[k] += c[k];
    }
    say(`| **all** | ${all.queries} | ${all.misses} | ${all.withMiss} | ${all.unjudged} | ${all.unclassified} |`);
  }
  const judgeDir = flag("--judge-dir");
  if (judgeDir) {
    const r = writeJudgeDir(judgeDir, queriesJson(), judge, store0);
    process.stderr.write(`judge dir ${judgeDir}: ${r.items} unjudged item(s) in ${r.batches} batch file(s)\n`);
  }
}

/** The arms #619's rule names: the α grid plus the two cosine tie-break rows. */
const GRID = Array.from({ length: 21 }, (_, i) => Math.round(i * 5) / 100);
const ARMS: Array<{ name: string; order: PoolOrder }> = [
  ...GRID.map((alpha) => ({ name: `a=${alpha.toFixed(2)}`, order: { kind: "blend", alpha } as PoolOrder })),
  { name: "tie-exact", order: { kind: "tieBreak", bucket: false } },
  { name: "tie-0.01", order: { kind: "tieBreak", bucket: true } },
];

/** #619: leave-one-out α over the book-scope queries of the deep dump. */
function blend(): void {
  const recs = deep.filter((r) => r.query.scope === "book" && !r.runs.hybrid?.isError);
  const lists = new Map<string, Map<string, RawHit[]>>();
  for (const rec of recs) {
    const { pool, rest } = productionPool(rec.runs.hybrid!.hits);
    lists.set(rec.query.id, new Map(ARMS.map((a) => [a.name, orderPool(pool, rest, a.order)])));
  }
  const judgeDir = flag("--judge-dir");
  if (judgeDir) {
    // every hit that enters any arm's top 5, once per location
    const judge = recs.map((rec): RawRecord => {
      const seen = new Map<string, RawHit>();
      for (const l of lists.get(rec.query.id)!.values()) for (const h of l.slice(0, 5)) seen.set(loc(h), h);
      return { query: rec.query, runs: { hybrid: { ...rec.runs.hybrid!, hits: [...seen.values()] } } };
    });
    const r = writeJudgeDir(judgeDir, queriesJson(), judge, store);
    process.stderr.write(`judge dir ${judgeDir}: ${r.items} unjudged item(s) in ${r.batches} batch file(s)\n`);
  }
  // per query, per arm: hit@5, reciprocal rank, unjudged count in the top 5, first grade-2 rank
  const scores = new Map<string, Map<string, { hit5: number; rr: number; holes: number; first: number }>>();
  for (const rec of recs) {
    const m = new Map<string, { hit5: number; rr: number; holes: number; first: number }>();
    for (const [arm, l] of lists.get(rec.query.id)!) {
      const g = gradeList(rec, l, store);
      const { hit5, rr } = hitAndRr(g);
      m.set(arm, { hit5, rr, holes: g.filter((x) => x === null).length, first: g.indexOf(2) + 1 });
    }
    scores.set(rec.query.id, m);
  }
  const ids = recs.map((r) => r.query.id);
  const s = (id: string, arm: string) => scores.get(id)!.get(arm)!;
  const meanOf = (arm: string, key: "hit5" | "rr", over = ids) => mean(over.map((id) => s(id, arm)[key]));
  const holes = (arm: string) => ids.reduce((n, id) => n + s(id, arm).holes, 0);

  say(`# #619 leave-one-out α (store ${storeFile})`);
  say();
  say(
    `Corpus: live library via the wave snapshot; deep dump ${poolDir} (topK ${deepTopK}). n = ${ids.length} book-scope queries.`,
  );
  say("Relevant = store grade 2. Rule: issue comment, 2026-11-18.");
  if (base.length) {
    // α = 1 must rebuild the production top 5 the base dump returned
    let same = 0;
    let compared = 0;
    for (const rec of recs) {
      const b = base.find((x) => x.query.id === rec.query.id)?.runs.hybrid?.hits;
      if (!b) continue;
      compared++;
      const a1 = lists.get(rec.query.id)!.get("a=1.00")!.slice(0, 5).map(loc).join(",");
      if (a1 === b.slice(0, 5).map(loc).join(",")) same++;
      else say(`- α = 1 differs from base on ${rec.query.id}: ${a1} vs ${b.slice(0, 5).map(loc).join(",")}`);
    }
    say(`- α = 1 reproduces the base dump's top 5 on ${same} of ${compared} queries.`);
  }
  // leave-one-out: α maximising mean MRR on the other 14, scored on the left-out query
  const units = ids.map((id) => ({ id, stratum: "book" }));
  const cv = crossValidate(
    leaveOneOut(units).folds,
    (train) => fitAlpha(GRID, (a) => meanOf(`a=${a.toFixed(2)}`, "rr", train)),
    (alpha, test) => s(test[0]!, `a=${alpha.toFixed(2)}`).rr,
  );
  const folds = leaveOneOut(units).folds.map((f, i) => ({ id: f[0]!, alpha: cv.perFold[i]!.fitted }));
  const looHit = folds.map((f) => s(f.id, `a=${f.alpha.toFixed(2)}`).hit5);
  const looRr = folds.map((f) => s(f.id, `a=${f.alpha.toFixed(2)}`).rr);
  const alphas = folds.map((f) => f.alpha).sort((a, b) => a - b);
  const q = (p: number) => alphas[Math.min(alphas.length - 1, Math.floor(p * (alphas.length - 1) + 0.5))]!;
  const inSample = fitAlpha(GRID, (a) => meanOf(`a=${a.toFixed(2)}`, "rr"));
  const b13 = ids.find((id) => id === "book-13");
  say();
  say(`## Rows (n = ${ids.length})`);
  say();
  say("| row | hit@5 | MRR | MRR SD | Hole@5 items | book-13 first grade-2 rank |");
  say("|---|---|---|---|---|---|");
  const b13rank = (arm: string) => (b13 ? s(b13, arm).first || "none" : "n/a");
  say(
    `| leave-one-out (out of sample) | ${fmt(mean(looHit))} | ${fmt(mean(looRr))} | ${fmt(sampleSd(looRr))} | – | ${b13 ? s(b13, `a=${folds.find((f) => f.id === b13)!.alpha.toFixed(2)}`).first || "none" : "n/a"} |`,
  );
  for (const arm of ["a=1.00", "a=0.50", "tie-exact", "tie-0.01", `a=${inSample.toFixed(2)}`]) {
    const label =
      arm === "a=1.00"
        ? "α = 1.0 (today)"
        : arm === "a=0.50"
          ? "α = 0.5 fixed"
          : arm.startsWith("tie")
            ? `rerank + cosine tie-break (${arm === "tie-exact" ? "exact" : "0.01 buckets"})`
            : `in-sample best α = ${inSample.toFixed(2)} (information)`;
    const rr = ids.map((id) => s(id, arm).rr);
    say(
      `| ${label} | ${fmt(meanOf(arm, "hit5"))} | ${fmt(mean(rr))} | ${fmt(sampleSd(rr))} | ${holes(arm)} | ${b13rank(arm)} |`,
    );
  }
  say();
  say("## Fold scatter");
  say();
  say(
    `Per-fold α: min ${q(0).toFixed(2)}, Q1 ${q(0.25).toFixed(2)}, median ${q(0.5).toFixed(2)}, Q3 ${q(0.75).toFixed(2)}, max ${q(1).toFixed(2)}; range ${(q(1) - q(0)).toFixed(2)} (${q(1) - q(0) > 0.3 ? "wide" : "not wide"} by the declared 0.3 label).`,
  );
  say();
  say("| left-out query | fitted α | out-of-sample RR | RR at α = 1 | hit@5 | hit@5 at α = 1 |");
  say("|---|---|---|---|---|---|");
  for (const f of folds) {
    const a = `a=${f.alpha.toFixed(2)}`;
    say(
      `| ${f.id} | ${f.alpha.toFixed(2)} | ${fmt(s(f.id, a).rr)} | ${fmt(s(f.id, "a=1.00").rr)} | ${s(f.id, a).hit5} | ${s(f.id, "a=1.00").hit5} |`,
    );
  }
  say();
  say("## Grid (all 15 queries, in sample)");
  say();
  say("| arm | hit@5 | MRR | Hole@5 items | RR wins vs α = 1 | RR losses vs α = 1 |");
  say("|---|---|---|---|---|---|");
  for (const { name } of ARMS) {
    const wins = ids.filter((id) => s(id, name).rr > s(id, "a=1.00").rr).length;
    const losses = ids.filter((id) => s(id, name).rr < s(id, "a=1.00").rr).length;
    say(
      `| ${name} | ${fmt(meanOf(name, "hit5"))} | ${fmt(meanOf(name, "rr"))} | ${holes(name)} | ${wins} | ${losses} |`,
    );
  }
  const jsonFile = flag("--json");
  if (jsonFile)
    writeFileSync(
      jsonFile,
      JSON.stringify(
        { folds, scores: Object.fromEntries([...scores].map(([k, v]) => [k, Object.fromEntries(v)])) },
        null,
        1,
      ),
    );
}

// dispatch last: the arm tables above are module consts
if (cmd === "admission") admission();
else blend();

const outFile = flag("--out");
if (outFile) writeFileSync(outFile, `${out.join("\n")}\n`);
else process.stdout.write(`${out.join("\n")}\n`);
