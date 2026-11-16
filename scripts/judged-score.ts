// Blind judged eval, step 3: unblind the judges' grades and score them per category and mode.
// Reads <runDir>/raw-hits.jsonl, blind-key.json, blind/*.json and judgements/*.json
// (judged-blind.workflow.js); writes <runDir>/blind-report.md. Final grade = the judges' shared grade
// (and coverage), else the adjudicator's. -1 (can't judge) is never a hit and stays out of κ; coverage
// E/S/L is reported beside the topical metrics, never inside them.
// With --store, the run's new final grades are appended to the judgment store and every hit is graded
// from it; a hit no stored grade covers is unjudged (null): never relevant, counted in Hole@5 (#361).
// Run: pnpm eval:judged:score <runDir> [--store <file>] [--strict-text] [--inline results.jsonl]
//      pnpm eval:judged:score --import <runDir> --store <file>   (seed the store from a judged run)
// --inline compares to an earlier single-judge pass, per-query hit@5 agreement — #602

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  blindTextLengths,
  cohenKappa,
  coverageSplit,
  gradesFor,
  KEYWORD_CATEGORIES,
  medianAndMax,
  metrics,
  qidOf,
  rubricViolations,
  type CategoryMetrics,
  type CoverageCounts,
  type FinalGrade,
  type RawRecord,
} from "./judged-lib.js";
import { lengthBreakdown, renderLengthBreakdown, type BookLengths } from "./judged-lengths.js";
import {
  appendJudgments,
  gradeFromStore,
  holeAt,
  idealGrades,
  importRun,
  judgmentsFromRun,
  loadRunDir,
  ndcgAt5,
  newJudgments,
  readStore,
  resolveRun,
  storePathError,
} from "./judged-store.js";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const importDir = flag("--import");
const storeFile = flag("--store");
const inlinePath = flag("--inline");
const opts = { strictText: argv.includes("--strict-text") };
const runDir = importDir ?? argv[0];
if (!runDir || runDir.startsWith("--") || (importDir && !storeFile)) {
  process.stderr.write(
    "usage: pnpm eval:judged:score <runDir> [--store <file>] [--strict-text] [--inline results.jsonl]\n" +
      "       pnpm eval:judged:score --import <runDir> --store <file> [--strict-text]\n",
  );
  process.exit(2);
}

const run = loadRunDir(runDir);
const pathError = storeFile && storePathError(storeFile, run.queriesJson);
if (pathError) {
  process.stderr.write(`${pathError}\n`);
  process.exit(2);
}

// --import seeds the store from an already judged run (the #602 baseline) and writes nothing into the run dir
if (importDir) {
  const before = readStore(storeFile!).length;
  const added = importRun(importDir, storeFile!, opts);
  process.stderr.write(
    `import ${run.name}: ${added.length} record(s) appended to ${storeFile} (${before} before, ${before + added.length} now)\n`,
  );
  process.exit(0);
}

const { raws, key } = run;
// a store run whose dump found nothing new has no blind batches and no judges to resolve
const resolution = storeFile && run.judges.size === 0 && run.blindText.size === 0 ? undefined : resolveRun(run);
const judgeNames = [...run.judges.keys()];
const adjudicated = run.adjudicated;
const hids = Object.keys(key);

// the run's new final grades go into the store (never over an existing record); the run is scored from it
const before = storeFile ? readStore(storeFile) : [];
const added = newJudgments(before, judgmentsFromRun(run, resolution?.final ?? new Map<string, FinalGrade>()), opts);
if (storeFile) appendJudgments(storeFile, added);
const store = [...before, ...added];
const final = gradeFromStore(raws, store, opts);
const violations = [...run.judges.entries(), ["adjudicated", adjudicated] as const].flatMap(([name, m]) =>
  rubricViolations([...m.values()]).map((v) => ({ judge: name, ...v })),
);

const pct = (x: number) => `${Math.round(100 * x)}%`;
const row = (name: string, m: CategoryMetrics, ndcg: number, hole: number, kw?: string) =>
  `| ${name} | ${m.n} | ${pct(m.hit1)} | ${pct(m.hit3)} | ${pct(m.hit5)} | ${pct(1 - m.hit5)} | ${pct(m.totalMiss)} | ${m.mrr.toFixed(2)} | ${m.p5.toFixed(2)} | ${ndcg.toFixed(2)} | ${pct(hole)} | ${kw ?? "-"} |`;

const positives = raws.filter((r) => r.query.category !== "neg" && !r.runs.hybrid?.isError);
const cats = [...new Set(positives.map((r) => r.query.category))];
const judgesLine = resolution
  ? `Judges: ${judgeNames.join(" + ")}; **Cohen's κ = ${cohenKappa(resolution.kappaPairs).toFixed(2)}** on ${resolution.kappaPairs.length} pairs both graded 0–2 ` +
    `(${resolution.gradedPairs - resolution.kappaPairs.length} pairs with a -1 left out), ` +
    `raw agreement ${pct(resolution.agreedPairs / (resolution.gradedPairs || 1))} on ${resolution.gradedPairs} pairs, ` +
    `${adjudicated.size} adjudicated, ${resolution.unresolved} unresolved (counted as unjudged).`
  : "Judges: none this run (every hit was already in the store).";
const lines: string[] = [
  "# Blind judged pass — scores",
  "",
  judgesLine,
  ...(storeFile
    ? [
        `Store: ${storeFile} — ${before.length} record(s) before this run, ${added.length} appended${opts.strictText ? " (strict text)" : ""}.`,
      ]
    : []),
  `Rubric violations: ${violations.length}` + (violations.length ? " (listed at the end)." : "."),
  "",
  "Unjudged hits (no stored grade) count as not relevant; Hole@5 = their share of the top-5 hits.",
  "",
  "| cat | n | hit@1 | hit@3 | hit@5 | miss | total miss | MRR | P@5 | NDCG@5 | Hole@5 | hybrid@3 vs kw@3 |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
];
const hybridOf = (r: RawRecord) => gradesFor(r.query.id, "hybrid", key, final);
// NDCG@5's ideal ranking: the best stored grades of the query at the index generation this run hit
const ndcgOf = (r: RawRecord) => {
  const v = r.runs.hybrid?.indexVersion;
  return v === undefined ? 0 : ndcgAt5(hybridOf(r), idealGrades(store, r.query.id, v, opts));
};
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const withCats = [...cats, "ALL"];
const inCat = (c: string) => (c === "ALL" ? positives : positives.filter((r) => r.query.category === c));
for (const c of withCats) {
  const rs = inCat(c);
  const withKw = rs.filter((r) => KEYWORD_CATEGORIES.has(r.query.category) && r.runs.keyword);
  const kw = withKw.length
    ? `${pct(metrics(withKw.map(hybridOf)).hit3)} vs ${pct(metrics(withKw.map((r) => gradesFor(r.query.id, "keyword", key, final))).hit3)}`
    : undefined;
  lines.push(row(c, metrics(rs.map(hybridOf)), meanOf(rs.map(ndcgOf)), holeAt(rs.map(hybridOf), 5), kw));
}
const kwRuns = raws.filter((r) => r.runs.keyword && !r.runs.keyword.isError);
if (kwRuns.length) {
  const kwHole = holeAt(
    kwRuns.map((r) => gradesFor(r.query.id, "keyword", key, final)),
    5,
  );
  lines.push("", `**Hole@5 (keyword runs):** ${pct(kwHole)} over ${kwRuns.length} queries.`);
}

// -1 per category and per judge: items in every pooled list of the category's queries
const catOfQid = new Map(raws.map((r) => [r.query.id, r.query.category]));
const hidsIn = (c: string) => hids.filter((h) => c === "ALL" || catOfQid.get(qidOf(h)) === c);
const allCats = [...new Set(raws.map((r) => r.query.category)), "ALL"];
const minusOne = (m: ReadonlyMap<string, { grade: number }> | undefined, hs: string[]) =>
  m ? String(hs.filter((h) => m.get(h)?.grade === -1).length) : "-";
const [nameA = "judge A", nameB = "judge B"] = judgeNames;
lines.push(
  "",
  "**Can't judge (-1)** — items per category; final = after adjudication (or from the store), never a hit.",
  "",
  `| cat | items | ${nameA} | ${nameB} | final |`,
  "|---|---|---|---|---|",
  ...allCats.map((c) => {
    const hs = hidsIn(c);
    return `| ${c} | ${hs.length} | ${minusOne(run.judges.get(nameA), hs)} | ${minusOne(run.judges.get(nameB), hs)} | ${minusOne(final, hs)} |`;
  }),
);

// coverage over the hybrid list (the one hit@k is computed on)
const hybridHids = (c: string) =>
  inCat(c).flatMap((r) => hids.filter((h) => qidOf(h) === r.query.id && key[h]?.hybrid !== undefined));
const cov = (x: CoverageCounts) => `${x.E} / ${x.S} / ${x.L}${x.none ? ` (+${x.none} untagged)` : ""}`;
lines.push(
  "",
  "**Coverage of hybrid hits** — E exact unit / S too small / L lateral; hit@k counts the topical grade only.",
  "",
  "| cat | grade 2: E / S / L | grade 1: E / S / L |",
  "|---|---|---|",
  ...withCats.map((c) => {
    const s = coverageSplit(hybridHids(c), final);
    return `| ${c} | ${cov(s["2"])} | ${cov(s["1"])} |`;
  }),
);

const negs = raws.filter((r) => r.query.category === "neg" && r.runs.hybrid);
const confidentNeg = negs.filter((r) => !r.runs.hybrid!.lowConfidence).map((r) => r.query.id);
const errors = raws.filter((r) => r.runs.hybrid?.isError).map((r) => r.query.id);
const totals = raws.map((r) => r.runs.hybrid?.timings?.totalMs).filter((t): t is number => t !== undefined);
const lat = medianAndMax(totals);
const missedButFlagged = positives.filter((r) => !hybridOf(r).includes(2) && r.runs.hybrid!.lowConfidence).length;
const misses = positives.filter((r) => !hybridOf(r).includes(2)).length;
lines.push(
  "",
  `**Negatives:** lowConfidence on ${negs.length - confidentNeg.length}/${negs.length}` +
    (confidentNeg.length ? ` — confident: ${confidentNeg.join(", ")}` : "") +
    ".",
  `**lowConfidence on misses:** ${missedButFlagged}/${misses} flagged.`,
  `**Latency (hybrid, debug timings):** ${lat ? `median ${Math.round(lat.median)} ms, worst ${lat.max} ms` : "not recorded"}.`,
  ...(errors.length ? [`**Errors:** ${errors.join(", ")}.`] : []),
);

if (inlinePath && existsSync(inlinePath)) {
  const inline = new Map(
    readFileSync(inlinePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: string; mode: string; judgements?: number[] })
      .filter((r) => r.mode === "hybrid" && Array.isArray(r.judgements))
      .map((r) => [r.id, r.judgements!.includes(2)]),
  );
  const both = positives.filter((r) => inline.has(r.query.id));
  const diff = both.filter((r) => inline.get(r.query.id) !== hybridOf(r).includes(2)).map((r) => r.query.id);
  lines.push(
    "",
    `**Inline vs blind (per-query hit@5):** agree on ${both.length - diff.length}/${both.length}` +
      (diff.length ? `; differ: ${diff.join(", ")}` : "") +
      ". Rankings can differ between runs, so read differences against raw-hits.jsonl.",
  );
}

// where slots and grades fall by book length (judged-dump writes book-lengths.json; older runs have none)
const lengthsFile = join(runDir, "book-lengths.json");
if (existsSync(lengthsFile)) {
  const bookLengths = JSON.parse(readFileSync(lengthsFile, "utf8")) as BookLengths;
  lines.push(...renderLengthBreakdown(lengthBreakdown(raws, key, final, bookLengths)));
}

// judged-text length beside each final grade: a long-text bias shows up as longer 2s than 0s
const lengths = blindTextLengths(raws);
const lenOf = (g: number) => [...final.entries()].filter(([, f]) => f.grade === g).map(([h]) => lengths.get(h) ?? 0);
lines.push(
  "",
  "**Judged-text length (chars), median by final grade:** " +
    [2, 1, 0, -1]
      .map((g) => {
        const m = medianAndMax(lenOf(g));
        return `${g}: ${m ? Math.round(m.median) : "-"} (n=${lenOf(g).length})`;
      })
      .join(" · ") +
    ".",
);

if (violations.length) {
  lines.push("", "## Rubric violations", "", ...violations.map((v) => `- ${v.judge} ${v.hid}: ${v.problem}`));
}

lines.push(
  "",
  "## Items",
  "",
  "| hid | final | coverage | length | hybrid rank | keyword rank |",
  "|---|---|---|---|---|---|",
  ...hids.map((h) => {
    const f = final.get(h);
    return `| ${h} | ${f?.grade ?? "unjudged"} | ${f?.coverage ?? "-"} | ${lengths.get(h) ?? "-"} | ${key[h]?.hybrid ?? "-"} | ${key[h]?.keyword ?? "-"} |`;
  }),
);

const report = `${lines.join("\n")}\n`;
writeFileSync(join(runDir, "blind-report.md"), report);
process.stdout.write(report);
