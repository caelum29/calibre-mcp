// Seeded, stratified fold splits for reporting fitted values honestly (#632): a value chosen by
// maximising a metric is reported on folds it was not fitted on. The unit is the query (never a
// report row), so every mode of one query stays in one fold. Works on any id set — the fixture
// (stratum = kind) or the judged live set (stratum = category).

import { mean, mulberry32, sampleSd, SEED } from "./stats.js";

/** One unit to split: a query id and the label it is stratified by. */
export interface FoldUnit {
  id: string;
  stratum: string;
}

/** A stratum with fewer units than folds: it lands in only `folds` of them. */
interface SparseStratum {
  stratum: string;
  units: number;
  folds: number;
}

/** Test folds (each unit in exactly one) plus the strata too small to reach every fold. */
export interface FoldSplit {
  folds: string[][];
  sparseStrata: SparseStratum[];
}

/** Units grouped by stratum, strata and ids sorted, so input order never changes the split. */
function byStratum(units: FoldUnit[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const u of units) groups.set(u.stratum, [...(groups.get(u.stratum) ?? []), u.id]);
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([s, ids]) => [s, ids.sort()]);
}

/** Fisher–Yates with the shared PRNG (in place). */
function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

/**
 * Stratified k-fold split: within each stratum, units are shuffled with the seeded PRNG and
 * dealt round-robin, so each fold's share of a stratum differs by at most one. The deal
 * continues across strata, which keeps the fold sizes balanced too.
 */
export function kFold(units: FoldUnit[], k = 5, seed = SEED): FoldSplit {
  if (!Number.isInteger(k) || k < 2) throw new Error(`k must be an integer ≥ 2 (got ${k})`);
  const rand = mulberry32(seed);
  const folds: string[][] = Array.from({ length: k }, () => []);
  const sparseStrata: SparseStratum[] = [];
  let next = 0;
  for (const [stratum, ids] of byStratum(units)) {
    for (const id of shuffle(ids, rand)) {
      folds[next]!.push(id);
      next = (next + 1) % k;
    }
    if (ids.length < k) sparseStrata.push({ stratum, units: ids.length, folds: ids.length });
  }
  return { folds, sparseStrata };
}

/** Leave-one-out: one unit per fold, in id order — the shape for small judged categories (n 5–20). */
export function leaveOneOut(units: FoldUnit[]): FoldSplit {
  return {
    folds: units
      .map((u) => u.id)
      .sort()
      .map((id) => [id]),
    sparseStrata: [],
  };
}

/** One fold of a cross-validation: the value fitted without it and its score on it. */
interface FoldResult<P> {
  fitted: P;
  score: number;
  /** Units in this test fold. */
  n: number;
}

/**
 * Cross-validate a fitted value: for each fold, `fit` on the other folds' ids, then `score`
 * the fitted value on this fold's ids. Returns the per-fold values and the scores' mean / SD.
 */
export function crossValidate<P>(
  folds: string[][],
  fit: (trainIds: string[]) => P,
  score: (fitted: P, testIds: string[]) => number,
): { perFold: FoldResult<P>[]; mean: number; sd: number } {
  const perFold = folds.map((test, i) => {
    const fitted = fit(folds.filter((_, j) => j !== i).flat());
    return { fitted, score: score(fitted, test), n: test.length };
  });
  const scores = perFold.map((f) => f.score);
  return { perFold, mean: mean(scores), sd: sampleSd(scores) };
}

/**
 * Seeded stratified sample of `n` ids: largest-remainder allocation of n over the strata
 * (ties → the larger stratum, then the stratum name), then the first ids of each stratum's
 * seeded shuffle. The #632 held-out draw; its ids are then frozen in queries.json.
 */
export function stratifiedSample(units: FoldUnit[], n: number, seed = SEED): string[] {
  const groups = byStratum(units);
  const total = units.length;
  if (!Number.isInteger(n) || n < 0 || n > total) throw new Error(`n must be an integer in 0..${total} (got ${n})`);
  const quotas = groups.map(([stratum, ids]) => {
    const exact = (n * ids.length) / total;
    return { stratum, size: ids.length, take: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = n - quotas.reduce((s, q) => s + q.take, 0);
  const byRemainder = [...quotas].sort(
    (a, b) => b.rest - a.rest || b.size - a.size || (a.stratum < b.stratum ? -1 : 1),
  );
  for (const q of byRemainder) {
    if (left === 0) break;
    q.take++;
    left--;
  }
  const rand = mulberry32(seed);
  return groups.flatMap(([, ids], i) => shuffle(ids, rand).slice(0, quotas[i]!.take));
}
