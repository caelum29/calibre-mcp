// Run-versus-run comparison for the blind judged eval: both runs graded from one judgment store,
// paired by query id per mode, overall and per category, with the seeded stats.ts primitives (#358)
// so the same inputs print the same numbers. Refuses what would mislead: different query sets, and
// unjudged hits in a compared top 5 (they would score as misses, not as measured misses) — #361

import { gradesFor, type BlindKey, type RawRecord } from "./judged-lib.js";
import {
  gradeFromStore,
  idealGrades,
  ndcgAt5,
  querySetHash,
  type MatchOptions,
  type StoredJudgment,
} from "./judged-store.js";
import {
  mean,
  minDetectableEffect,
  pairedBootstrapCI,
  pairedPermutationTest,
  sampleSd,
  signTest,
} from "../test/eval/retrieval/stats.js";

/** What compare needs of one judged run. */
export interface CompareRun {
  name: string;
  dir: string;
  queriesJson: string;
  raws: RawRecord[];
  key: BlindKey;
}

type Mode = "hybrid" | "keyword";

/** One paired row: run B against run A, one mode, overall or one category. */
export interface JudgedCompareRow {
  mode: Mode;
  /** "overall" or a query category. */
  group: string;
  /** Queries scored in BOTH runs (paired by id). */
  n: number;
  ndcgA: number;
  ndcgACi: [number, number];
  ndcgB: number;
  ndcgBCi: [number, number];
  hit5A: number;
  hit5ACi: [number, number];
  hit5B: number;
  hit5BCi: [number, number];
  /** Mean per-query NDCG@5 difference B − A. */
  delta: number;
  ci: [number, number];
  /** Permutation p on the NDCG@5 differences. */
  p: number;
  /** Queries B hits at 5 and A misses / the reverse. */
  hit5Wins: number;
  hit5Losses: number;
  signP: number;
  mde: number;
  /** Not significant AND |Δ| below the minimum detectable effect: no conclusion either way. */
  underpowered: boolean;
}

/** Header facts that make a comparison reproducible. */
export interface CompareHeader {
  a: string;
  b: string;
  querySetSha256: string;
  storeFile: string;
  storeSha256: string;
  records: number;
}

const MODES: readonly Mode[] = ["hybrid", "keyword"];

/** Queries one mode scores in a run: positives whose mode run exists and did not error. */
const scored = (run: CompareRun, mode: Mode) =>
  run.raws.filter((r) => r.query.category !== "neg" && r.runs[mode] && !r.runs[mode].isError);

/** Modes both runs ran on at least one scored query. */
const sharedModes = (a: CompareRun, b: CompareRun) =>
  MODES.filter((m) => scored(a, m).length > 0 && scored(b, m).length > 0);

/** Why two runs can't be compared (undefined = they can). */
export function compareRefusal(
  a: CompareRun,
  b: CompareRun,
  store: readonly StoredJudgment[],
  storeFile: string,
  opts: MatchOptions = {},
): string | undefined {
  const [ha, hb] = [a, b].map((r) => querySetHash(r.queriesJson).slice(0, 12));
  if (ha !== hb) {
    return `refusing: query sets differ (${a.name} ${ha}, ${b.name} ${hb}); compare runs of the same queries.json`;
  }
  for (const run of [a, b]) {
    const graded = gradeFromStore(run.raws, store, opts);
    const holes: string[] = [];
    for (const mode of sharedModes(a, b)) {
      for (const r of scored(run, mode)) {
        gradesFor(r.query.id, mode, run.key, graded)
          .slice(0, 5)
          .forEach((g, i) => {
            if (g === null) holes.push(`${r.query.id} ${mode} rank ${i + 1}`);
          });
      }
    }
    if (holes.length) {
      return (
        `refusing: run ${run.name} has ${holes.length} unjudged hit(s) in a top 5 (first: ${holes[0]}); fill the holes with ` +
        `pnpm eval:judged:dump ${run.dir} --store ${storeFile}, judge the new batches, then pnpm eval:judged:score ${run.dir} --store ${storeFile}`
      );
    }
  }
  return undefined;
}

/** Per-query NDCG@5 and hit@5 of one run in one mode, keyed by query id. */
function perQuery(run: CompareRun, mode: Mode, store: readonly StoredJudgment[], opts: MatchOptions) {
  const graded = gradeFromStore(run.raws, store, opts);
  const out = new Map<string, { category: string; ndcg: number; hit5: number }>();
  for (const r of scored(run, mode)) {
    const grades = gradesFor(r.query.id, mode, run.key, graded);
    const v = r.runs[mode]!.indexVersion;
    out.set(r.query.id, {
      category: r.query.category,
      // the ideal ranking is the store's best grades at the index generation THIS run hit
      ndcg: v === undefined ? 0 : ndcgAt5(grades, idealGrades(store, r.query.id, v, opts)),
      hit5: grades.slice(0, 5).includes(2) ? 1 : 0,
    });
  }
  return out;
}

type Pair = [{ ndcg: number; hit5: number }, { ndcg: number; hit5: number }];

function pairedRow(mode: Mode, group: string, pairs: Pair[]): JudgedCompareRow {
  const a = pairs.map(([x]) => x.ndcg);
  const b = pairs.map(([, y]) => y.ndcg);
  const ha = pairs.map(([x]) => x.hit5);
  const hb = pairs.map(([, y]) => y.hit5);
  const diffs = pairs.map(([x, y]) => y.ndcg - x.ndcg);
  const wins = pairs.filter(([x, y]) => x.hit5 === 0 && y.hit5 === 1).length;
  const losses = pairs.filter(([x, y]) => x.hit5 === 1 && y.hit5 === 0).length;
  const delta = mean(diffs);
  const p = pairedPermutationTest(diffs);
  const mde = minDetectableEffect(sampleSd(diffs), pairs.length);
  return {
    mode,
    group,
    n: pairs.length,
    // a bootstrap of one run's per-query values is its mean's interval
    ndcgA: mean(a),
    ndcgACi: pairedBootstrapCI(a),
    ndcgB: mean(b),
    ndcgBCi: pairedBootstrapCI(b),
    hit5A: mean(ha),
    hit5ACi: pairedBootstrapCI(ha),
    hit5B: mean(hb),
    hit5BCi: pairedBootstrapCI(hb),
    delta,
    ci: pairedBootstrapCI(diffs),
    p,
    hit5Wins: wins,
    hit5Losses: losses,
    signP: signTest(wins, losses),
    mde,
    underpowered: p >= 0.05 && Math.abs(delta) < mde,
  };
}

/** Paired rows per mode both runs have: "overall", then one per category (alphabetical); negatives drop out. */
export function compareJudgedRuns(
  a: CompareRun,
  b: CompareRun,
  store: readonly StoredJudgment[],
  opts: MatchOptions = {},
): JudgedCompareRow[] {
  const rows: JudgedCompareRow[] = [];
  for (const mode of sharedModes(a, b)) {
    const qa = perQuery(a, mode, store, opts);
    const qb = perQuery(b, mode, store, opts);
    const ids = [...qa.keys()].filter((id) => qb.has(id));
    const pairsOf = (keep: (id: string) => boolean) => ids.filter(keep).map((id): Pair => [qa.get(id)!, qb.get(id)!]);
    rows.push(
      pairedRow(
        mode,
        "overall",
        pairsOf(() => true),
      ),
    );
    const cats = [...new Set(ids.map((id) => qa.get(id)!.category))].sort();
    for (const c of cats) {
      rows.push(
        pairedRow(
          mode,
          c,
          pairsOf((id) => qa.get(id)!.category === c),
        ),
      );
    }
  }
  return rows;
}

const f3 = (x: number) => x.toFixed(3);
const signed = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(3)}`;
const ci = ([lo, hi]: [number, number], fmt: (x: number) => string) => `[${fmt(lo)}, ${fmt(hi)}]`;

/** Fixed-width text report (stdout): header with run names and hashes, then one line per row. */
export function renderJudgedCompare(rows: readonly JudgedCompareRow[], h: CompareHeader): string {
  const lines = [
    `compare ${h.b} − ${h.a} (paired by query id; Δ = NDCG@5 ${h.b} − ${h.a}, gain 2^grade − 1; flips = hit@5 wins/losses for ${h.b})`,
    `query set sha256 ${h.querySetSha256}`,
    `store ${h.storeFile} sha256 ${h.storeSha256} (${h.records} records)`,
    "",
    [
      "mode".padEnd(9),
      "group".padEnd(10),
      "n".padStart(4),
      `  NDCG@5 ${h.a} [95% CI]`.padEnd(28),
      `  NDCG@5 ${h.b} [95% CI]`.padEnd(28),
      `  hit@5 ${h.a} [95% CI]`.padEnd(28),
      `  hit@5 ${h.b} [95% CI]`.padEnd(28),
      "       Δ",
      "  95% CI".padEnd(20),
      "  perm p",
      "  flips",
      "  sign p",
      "    MDE",
      "  note",
    ].join(""),
  ];
  for (const r of rows) {
    lines.push(
      [
        r.mode.padEnd(9),
        r.group.padEnd(10),
        String(r.n).padStart(4),
        `  ${f3(r.ndcgA)} ${ci(r.ndcgACi, f3)}`.padEnd(28),
        `  ${f3(r.ndcgB)} ${ci(r.ndcgBCi, f3)}`.padEnd(28),
        `  ${f3(r.hit5A)} ${ci(r.hit5ACi, f3)}`.padEnd(28),
        `  ${f3(r.hit5B)} ${ci(r.hit5BCi, f3)}`.padEnd(28),
        `  ${signed(r.delta)}`,
        `  ${ci(r.ci, signed)}`.padEnd(20),
        `  ${r.p.toFixed(4)}`,
        `  ${`${r.hit5Wins}/${r.hit5Losses}`.padStart(5)}`,
        `  ${r.signP.toFixed(4)}`,
        `  ${(Number.isFinite(r.mde) ? f3(r.mde) : "inf").padStart(5)}`,
        r.underpowered ? "  UNDERPOWERED" : "",
      ].join(""),
    );
  }
  return lines.join("\n");
}
