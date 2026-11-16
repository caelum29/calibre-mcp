// Blind judged eval, step 3: unblind the judges' grades and score them per category and mode.
// Reads <runDir>/raw-hits.jsonl, blind-key.json and judgements/*.json (judged-blind.workflow.js);
// writes <runDir>/blind-report.md. Final grade = the judges' shared grade, else the adjudicator's.
// Run: pnpm eval:judged:score <runDir> [--inline results.jsonl]   (--inline compares to an
// earlier single-judge pass, per-query hit@5 agreement) — #602

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cohenKappa,
  gradesFor,
  KEYWORD_CATEGORIES,
  medianAndMax,
  metrics,
  type BlindKey,
  type CategoryMetrics,
  type Grade,
  type RawRecord,
} from "./judged-lib.js";

const [runDir, ...rest] = process.argv.slice(2);
if (!runDir) {
  process.stderr.write("usage: pnpm eval:judged:score <runDir> [--inline results.jsonl]\n");
  process.exit(2);
}
const inlineFlag = rest.indexOf("--inline");
const inlinePath = inlineFlag >= 0 ? rest[inlineFlag + 1] : undefined;

const raws = readFileSync(join(runDir, "raw-hits.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as RawRecord);
const key = JSON.parse(readFileSync(join(runDir, "blind-key.json"), "utf8")) as BlindKey;

// judgements/<judge>-batch-NN.json and adjudicated-batch-NN.json
const jdir = join(runDir, "judgements");
const byJudge = new Map<string, Map<string, number>>();
for (const f of readdirSync(jdir).filter((n) => n.endsWith(".json"))) {
  const judge = f.replace(/-batch-\d+\.json$/, "");
  const grades = JSON.parse(readFileSync(join(jdir, f), "utf8")) as Grade[];
  const m = byJudge.get(judge) ?? new Map<string, number>();
  for (const g of grades) m.set(g.hid, g.grade);
  byJudge.set(judge, m);
}
const adjudicated = byJudge.get("adjudicated") ?? new Map<string, number>();
const judgeNames = [...byJudge.keys()].filter((n) => n !== "adjudicated").sort();
if (judgeNames.length !== 2) throw new Error(`expected 2 judges in ${jdir}, found: ${judgeNames.join(", ") || "none"}`);
const [ja, jb] = judgeNames.map((n) => byJudge.get(n)!) as [Map<string, number>, Map<string, number>];

// final grade per blind item; an unresolved disagreement (no adjudication) counts as missing
const final = new Map<string, number>();
const pairs: Array<[number, number]> = [];
let unresolved = 0;
for (const hid of Object.keys(key)) {
  const a = ja.get(hid);
  const b = jb.get(hid);
  if (a !== undefined && b !== undefined) pairs.push([a, b]);
  if (a !== undefined && a === b) final.set(hid, a);
  else if (adjudicated.has(hid)) final.set(hid, adjudicated.get(hid)!);
  else unresolved += 1;
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
const row = (name: string, m: CategoryMetrics, kw?: string) =>
  `| ${name} | ${m.n} | ${pct(m.hit1)} | ${pct(m.hit3)} | ${pct(m.hit5)} | ${pct(1 - m.hit5)} | ${pct(m.totalMiss)} | ${m.mrr.toFixed(2)} | ${m.p5.toFixed(2)} | ${kw ?? "-"} |`;

const positives = raws.filter((r) => r.query.category !== "neg" && !r.runs.hybrid?.isError);
const cats = [...new Set(positives.map((r) => r.query.category))];
const lines: string[] = [
  "# Blind judged pass — scores",
  "",
  `Judges: ${judgeNames.join(" + ")}; ${pairs.length} paired grades, **Cohen's κ = ${cohenKappa(pairs).toFixed(2)}**, ` +
    `raw agreement ${pct(pairs.filter(([a, b]) => a === b).length / (pairs.length || 1))}, ` +
    `${adjudicated.size} adjudicated, ${unresolved} unresolved (counted as missing).`,
  "",
  "| cat | n | hit@1 | hit@3 | hit@5 | miss | total miss | MRR | P@5 | hybrid@3 vs kw@3 |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
const hybridOf = (r: RawRecord) => gradesFor(r.query.id, "hybrid", key, final);
for (const c of [...cats, "ALL"]) {
  const rs = c === "ALL" ? positives : positives.filter((r) => r.query.category === c);
  const withKw = rs.filter((r) => KEYWORD_CATEGORIES.has(r.query.category) && r.runs.keyword);
  const kw = withKw.length
    ? `${pct(metrics(withKw.map(hybridOf)).hit3)} vs ${pct(metrics(withKw.map((r) => gradesFor(r.query.id, "keyword", key, final))).hit3)}`
    : undefined;
  lines.push(row(c, metrics(rs.map(hybridOf)), kw));
}

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

const report = `${lines.join("\n")}\n`;
writeFileSync(join(runDir, "blind-report.md"), report);
process.stdout.write(report);
