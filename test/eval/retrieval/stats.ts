// Paired significance stats for comparing two eval reports (#358): at n = 59 a real tuning
// difference is easily below noise, so `pnpm eval --compare` reports p, CI and MDE, not just Δ.
// All randomness uses a fixed-seed PRNG, so the same two reports always print the same numbers.

import type { EvalReport, Mode, PerQueryRow } from "./harness.js";

/** Fixed default seed — any constant works; it only has to never change between runs. */
const SEED = 0x358;
const ITERATIONS = 10_000;
/** z for two-sided α = 0.05 and for 80% power. */
const Z_ALPHA = 1.959964;
const Z_POWER = 0.841621;

/** mulberry32: tiny deterministic PRNG in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
/** Arithmetic mean; 0 for an empty list. */
export const mean = (xs: number[]): number => (xs.length === 0 ? 0 : sum(xs) / xs.length);

/** Sample standard deviation (n − 1); 0 for fewer than two values. */
function sampleSd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** C(n, k) as a float — exact for the n this eval sees (≤ a few hundred flips). */
function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * Exact two-sided sign test on Hit@1 flips: under H0 a flip is equally likely either way.
 * Ties (both hit or both miss) carry no information and are not passed in.
 */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

/**
 * Two-sided paired sign-flip permutation test on per-query differences. Exact enumeration when
 * 2^n ≤ iterations (zeros can't change a sum, so only non-zero diffs count); otherwise Monte
 * Carlo with the fixed seed and the (count + 1) / (iterations + 1) estimator.
 */
export function pairedPermutationTest(diffs: number[], opts: { iterations?: number; seed?: number } = {}): number {
  const xs = diffs.filter((d) => d !== 0);
  if (xs.length === 0) return 1;
  const iterations = opts.iterations ?? ITERATIONS;
  const observed = Math.abs(sum(xs));
  // tolerance so a pattern that reproduces the observed sum exactly isn't lost to float order
  const reaches = (s: number) => Math.abs(s) >= observed - 1e-9;
  if (2 ** xs.length <= iterations) {
    let hits = 0;
    const total = 2 ** xs.length;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < xs.length; i++) s += mask & (1 << i) ? -xs[i]! : xs[i]!;
      if (reaches(s)) hits++;
    }
    return hits / total;
  }
  const rand = mulberry32(opts.seed ?? SEED);
  let hits = 0;
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (const x of xs) s += rand() < 0.5 ? -x : x;
    if (reaches(s)) hits++;
  }
  return (hits + 1) / (iterations + 1);
}

/** Percentile bootstrap CI of the mean paired difference (fixed seed). */
export function pairedBootstrapCI(
  diffs: number[],
  opts: { iterations?: number; seed?: number; alpha?: number } = {},
): [number, number] {
  const n = diffs.length;
  if (n === 0) return [0, 0];
  const iterations = opts.iterations ?? ITERATIONS;
  const alpha = opts.alpha ?? 0.05;
  const rand = mulberry32(opts.seed ?? SEED);
  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rand() * n)]!;
    means.push(s / n);
  }
  means.sort((x, y) => x - y);
  const lo = means[Math.floor((alpha / 2) * iterations)]!;
  const hi = means[Math.min(iterations - 1, Math.ceil((1 - alpha / 2) * iterations) - 1)]!;
  return [lo, hi];
}

/**
 * Minimum detectable paired mean difference at two-sided α = 0.05 and 80% power (normal
 * approximation): (z_α/2 + z_power) · SD / √n. Infinity when n < 2.
 */
export function minDetectableEffect(sd: number, n: number): number {
  if (n < 2) return Number.POSITIVE_INFINITY;
  return ((Z_ALPHA + Z_POWER) * sd) / Math.sqrt(n);
}

/** One paired comparison: report b vs report a, one mode, overall or one kind. */
export interface CompareRow {
  mode: Mode;
  /** "overall" or a query kind. */
  group: string;
  /** Queries with rank metrics in BOTH reports (paired by id). */
  n: number;
  meanA: number;
  meanB: number;
  /** Mean of per-query nDCG@10 (b − a). */
  delta: number;
  ci: [number, number];
  /** Permutation p on the nDCG@10 diffs. */
  p: number;
  /** Queries b hits at 1 and a misses / the reverse. */
  hit1Wins: number;
  hit1Losses: number;
  signP: number;
  mde: number;
  /**
   * Not significant (p ≥ 0.05) AND |Δ| < MDE: this n can't tell such a difference from noise
   * at 80% power, so "no difference" is not a conclusion either. A significant Δ is never flagged.
   */
  underpowered: boolean;
  /** Share of paired queries both reports solve at Hit@1 — they can't discriminate. */
  headroom: number;
}

function compareRows(mode: Mode, group: string, pairs: [PerQueryRow, PerQueryRow][]): CompareRow {
  const a = pairs.map(([x]) => x.metrics!.ndcg10);
  const b = pairs.map(([, y]) => y.metrics!.ndcg10);
  const diffs = pairs.map(([x, y]) => y.metrics!.ndcg10 - x.metrics!.ndcg10);
  const wins = pairs.filter(([x, y]) => x.metrics!.hit1 === 0 && y.metrics!.hit1 === 1).length;
  const losses = pairs.filter(([x, y]) => x.metrics!.hit1 === 1 && y.metrics!.hit1 === 0).length;
  const both = pairs.filter(([x, y]) => x.metrics!.hit1 === 1 && y.metrics!.hit1 === 1).length;
  const delta = mean(diffs);
  const mde = minDetectableEffect(sampleSd(diffs), pairs.length);
  const p = pairedPermutationTest(diffs);
  return {
    mode,
    group,
    n: pairs.length,
    meanA: mean(a),
    meanB: mean(b),
    delta,
    ci: pairedBootstrapCI(diffs),
    p,
    hit1Wins: wins,
    hit1Losses: losses,
    signP: signTest(wins, losses),
    mde,
    underpowered: p >= 0.05 && Math.abs(delta) < mde,
    headroom: pairs.length === 0 ? 0 : both / pairs.length,
  };
}

/**
 * Paired per-mode comparison of two reports: an "overall" row, then one row per non-empty
 * `extraGroups` subset (in key order; e.g. the sweep's RU-involved slice, which isn't a kind),
 * then one row per query kind (alphabetical). Only queries with rank metrics in both reports
 * pair; negatives drop out.
 */
export function compareReports(
  a: EvalReport,
  b: EvalReport,
  extraGroups: Record<string, (r: PerQueryRow) => boolean> = {},
): CompareRow[] {
  const rows: CompareRow[] = [];
  const modes = a.meta.modes.filter((m) => b.meta.modes.includes(m));
  for (const mode of modes) {
    const bById = new Map(b.perQuery.filter((r) => r.mode === mode && r.metrics).map((r) => [r.id, r]));
    const pairs = a.perQuery
      .filter((r) => r.mode === mode && r.metrics && bById.has(r.id))
      .map((r): [PerQueryRow, PerQueryRow] => [r, bById.get(r.id)!]);
    rows.push(compareRows(mode, "overall", pairs));
    for (const [group, pick] of Object.entries(extraGroups)) {
      const sub = pairs.filter(([r]) => pick(r));
      if (sub.length) rows.push(compareRows(mode, group, sub));
    }
    const kinds = [...new Set(pairs.map(([r]) => r.kind))].sort();
    for (const kind of kinds)
      rows.push(
        compareRows(
          mode,
          kind,
          pairs.filter(([r]) => r.kind === kind),
        ),
      );
  }
  return rows;
}

/**
 * Warnings for modes where fewer queries paired than either report holds — e.g. fixture vs live
 * would otherwise compare a silent 24-query subset as if it were the whole set.
 */
export function pairingWarnings(a: EvalReport, b: EvalReport, labelA = "a", labelB = "b"): string[] {
  const scored = (r: EvalReport, mode: Mode) => r.perQuery.filter((q) => q.mode === mode && q.metrics);
  const out: string[] = [];
  for (const mode of a.meta.modes.filter((m) => b.meta.modes.includes(m))) {
    const aIds = new Set(scored(a, mode).map((q) => q.id));
    const bIds = scored(b, mode).map((q) => q.id);
    const paired = bIds.filter((id) => aIds.has(id)).length;
    if (paired < aIds.size || paired < bIds.length) {
      out.push(
        `WARNING: ${mode} pairs only ${paired} queries — ${labelA} has ${aIds.size}, ${labelB} has ${bIds.length} with rank metrics; the rest are not compared`,
      );
    }
  }
  return out;
}

const signed = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(3)}`;

/** One-line paired verdict for a scorer check: n, Δ nDCG@10, CI, both p values, MDE, flag. */
export function formatPaired(r: CompareRow): string {
  return (
    `${r.group} paired n=${r.n} Δ ${signed(r.delta)} 95% CI [${signed(r.ci[0])}, ${signed(r.ci[1])}] ` +
    `perm p ${r.p.toFixed(4)} flips ${r.hit1Wins}/${r.hit1Losses} sign p ${r.signP.toFixed(4)} MDE ${r.mde.toFixed(3)}` +
    (r.underpowered ? " UNDERPOWERED" : "")
  );
}

/** Fixed-width text table for the CLI (stdout). */
export function renderCompare(rows: CompareRow[], labelA: string, labelB: string): string {
  const lines = [
    `compare ${labelB} − ${labelA} (paired by query id; Δ = nDCG@10 b − a; flips = Hit@1 wins/losses for b)`,
    [
      "mode".padEnd(9),
      "group".padEnd(20),
      "n".padStart(4),
      "   meanA",
      "  meanB",
      "       Δ",
      "  95% CI            ",
      "  perm p",
      "  flips",
      "  sign p",
      "    MDE",
      "  headroom",
      "  note",
    ].join(""),
  ];
  for (const r of rows) {
    lines.push(
      [
        r.mode.padEnd(9),
        r.group.padEnd(20),
        String(r.n).padStart(4),
        `   ${r.meanA.toFixed(3)}`,
        `  ${r.meanB.toFixed(3)}`,
        `  ${signed(r.delta)}`,
        `  ${`[${signed(r.ci[0])}, ${signed(r.ci[1])}]`.padEnd(18)}`,
        `  ${r.p.toFixed(4)}`,
        `  ${`${r.hit1Wins}/${r.hit1Losses}`.padStart(5)}`,
        `  ${r.signP.toFixed(4)}`,
        `  ${r.mde.toFixed(3).padStart(5)}`,
        `  ${`${(r.headroom * 100).toFixed(1)}%`.padStart(8)}`,
        r.underpowered ? "  UNDERPOWERED" : "",
      ].join(""),
    );
  }
  return lines.join("\n");
}
