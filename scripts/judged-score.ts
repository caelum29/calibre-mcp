// Blind judged eval, step 3: unblind the judges' grades and score them per category and mode.
// Reads <runDir>/raw-hits.jsonl, blind-key.json and judgements/*.json (judged-blind.workflow.js);
// writes <runDir>/blind-report.md. Final grade = the judges' shared grade (and coverage), else the
// adjudicator's. -1 (can't judge) is never a hit and stays out of κ; coverage E/S/L is reported
// beside the topical metrics, never inside them.
// Run: pnpm eval:judged:score <runDir> [--inline results.jsonl]   (--inline compares to an
// earlier single-judge pass, per-query hit@5 agreement) — #602

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  resolveGrades,
  rubricViolations,
  type BlindKey,
  type CategoryMetrics,
  type CoverageCounts,
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
const byJudge = new Map<string, Map<string, Grade>>();
for (const f of readdirSync(jdir).filter((n) => n.endsWith(".json"))) {
  const judge = f.replace(/-batch-\d+\.json$/, "");
  const grades = JSON.parse(readFileSync(join(jdir, f), "utf8")) as Grade[];
  const m = byJudge.get(judge) ?? new Map<string, Grade>();
  for (const g of grades) m.set(g.hid, g);
  byJudge.set(judge, m);
}
const adjudicated = byJudge.get("adjudicated") ?? new Map<string, Grade>();
const judgeNames = [...byJudge.keys()].filter((n) => n !== "adjudicated").sort();
if (judgeNames.length !== 2) throw new Error(`expected 2 judges in ${jdir}, found: ${judgeNames.join(", ") || "none"}`);
const [ja, jb] = judgeNames.map((n) => byJudge.get(n)!) as [Map<string, Grade>, Map<string, Grade>];

const hids = Object.keys(key);
const { final, kappaPairs, gradedPairs, agreedPairs, unresolved } = resolveGrades(hids, ja, jb, adjudicated);
const violations = [...byJudge.entries()].flatMap(([name, m]) =>
  rubricViolations([...m.values()]).map((v) => ({ judge: name, ...v })),
);

const pct = (x: number) => `${Math.round(100 * x)}%`;
const row = (name: string, m: CategoryMetrics, kw?: string) =>
  `| ${name} | ${m.n} | ${pct(m.hit1)} | ${pct(m.hit3)} | ${pct(m.hit5)} | ${pct(1 - m.hit5)} | ${pct(m.totalMiss)} | ${m.mrr.toFixed(2)} | ${m.p5.toFixed(2)} | ${kw ?? "-"} |`;

const positives = raws.filter((r) => r.query.category !== "neg" && !r.runs.hybrid?.isError);
const cats = [...new Set(positives.map((r) => r.query.category))];
const lines: string[] = [
  "# Blind judged pass — scores",
  "",
  `Judges: ${judgeNames.join(" + ")}; **Cohen's κ = ${cohenKappa(kappaPairs).toFixed(2)}** on ${kappaPairs.length} pairs both graded 0–2 ` +
    `(${gradedPairs - kappaPairs.length} pairs with a -1 left out), ` +
    `raw agreement ${pct(agreedPairs / (gradedPairs || 1))} on ${gradedPairs} pairs, ` +
    `${adjudicated.size} adjudicated, ${unresolved} unresolved (counted as missing).`,
  `Rubric violations: ${violations.length}` + (violations.length ? " (listed at the end)." : "."),
  "",
  "| cat | n | hit@1 | hit@3 | hit@5 | miss | total miss | MRR | P@5 | hybrid@3 vs kw@3 |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
const hybridOf = (r: RawRecord) => gradesFor(r.query.id, "hybrid", key, final);
const withCats = [...cats, "ALL"];
const inCat = (c: string) => (c === "ALL" ? positives : positives.filter((r) => r.query.category === c));
for (const c of withCats) {
  const rs = inCat(c);
  const withKw = rs.filter((r) => KEYWORD_CATEGORIES.has(r.query.category) && r.runs.keyword);
  const kw = withKw.length
    ? `${pct(metrics(withKw.map(hybridOf)).hit3)} vs ${pct(metrics(withKw.map((r) => gradesFor(r.query.id, "keyword", key, final))).hit3)}`
    : undefined;
  lines.push(row(c, metrics(rs.map(hybridOf)), kw));
}

// -1 per category and per judge: items in every pooled list of the category's queries
const catOfQid = new Map(raws.map((r) => [r.query.id, r.query.category]));
const hidsIn = (c: string) => hids.filter((h) => c === "ALL" || catOfQid.get(qidOf(h)) === c);
const allCats = [...new Set(raws.map((r) => r.query.category)), "ALL"];
const minusOne = (m: ReadonlyMap<string, { grade: number }>, hs: string[]) =>
  hs.filter((h) => m.get(h)?.grade === -1).length;
lines.push(
  "",
  "**Can't judge (-1)** — items per category; final = after adjudication, never a hit.",
  "",
  `| cat | items | ${judgeNames[0]} | ${judgeNames[1]} | final |`,
  "|---|---|---|---|---|",
  ...allCats.map((c) => {
    const hs = hidsIn(c);
    return `| ${c} | ${hs.length} | ${minusOne(ja, hs)} | ${minusOne(jb, hs)} | ${minusOne(final, hs)} |`;
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
    return `| ${h} | ${f?.grade ?? "unresolved"} | ${f?.coverage ?? "-"} | ${lengths.get(h) ?? "-"} | ${key[h]?.hybrid ?? "-"} | ${key[h]?.keyword ?? "-"} |`;
  }),
);

const report = `${lines.join("\n")}\n`;
writeFileSync(join(runDir, "blind-report.md"), report);
process.stdout.write(report);
