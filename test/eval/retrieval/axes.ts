// Report-only eval axes (#363, thresholds.reportOnlyAxes): snippet marker rate, book-scope
// span-hit@k, confidence calibration (false-flag rate + AUC), p50/p95 latency and the rerank
// on/off ablation matrix. Printed by every `pnpm eval` run; no gate reads them (D-012: an axis
// becomes a gate only through a new rule commit before the run that measures it).

import type { Thresholds } from "./gate.js";
import type { EvalReport, Mode, PerQueryRow } from "./harness.js";

/** One mode's report-only numbers; an axis is absent when the mode has no rows for it. */
export interface ModeAxes {
  snippetMarker: { shown: number; n: number };
  spanHit: { n: number; at1: number; at3: number; at5: number };
  confidence?: {
    /** Reranked rows (maxRerank set): positives with metrics + negatives. */
    n: number;
    hit1Positives: number;
    /** Hit@1 = 1 positives the tool still flagged low-confidence. */
    falseFlagged: number;
    aucMaxRerank: number;
    aucMargin: number;
  };
  latency?: { n: number; p50: number; p95: number };
}

/**
 * Mann-Whitney AUC: the share of (positive, negative) pairs where the positive scores higher,
 * ties counting half. NaN when either side is empty (no pairs to rank).
 */
export function auc(pos: number[], neg: number[]): number {
  if (pos.length === 0 || neg.length === 0) return Number.NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** Nearest-rank percentile (q in (0, 1]) — an observed value, no interpolation. */
export function percentile(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
}

function confidenceAxis(rows: PerQueryRow[]): ModeAxes["confidence"] {
  const ranked = rows.filter((r) => r.maxRerank !== undefined && (r.metrics || r.flagged !== undefined));
  if (ranked.length === 0) return undefined;
  // "right" = the top hit is correct; misses and negatives are what the flag should catch
  const right = ranked.filter((r) => r.metrics?.hit1 === 1);
  const wrong = ranked.filter((r) => r.metrics?.hit1 !== 1);
  const margin = (r: PerQueryRow) => r.maxRerank! - (r.top2Rerank ?? 0);
  return {
    n: ranked.length,
    hit1Positives: right.length,
    falseFlagged: right.filter((r) => r.lowConfidence === true).length,
    aucMaxRerank: auc(
      right.map((r) => r.maxRerank!),
      wrong.map((r) => r.maxRerank!),
    ),
    aucMargin: auc(right.map(margin), wrong.map(margin)),
  };
}

/** Compute every report-only axis per mode of `report`. */
export function computeAxes(report: EvalReport): Partial<Record<Mode, ModeAxes>> {
  const out: Partial<Record<Mode, ModeAxes>> = {};
  for (const mode of report.meta.modes) {
    const rows = report.perQuery.filter((r) => r.mode === mode);
    const book = rows.filter((r) => r.scope === "book" && r.metrics && r.spanHit !== undefined);
    const located = book.filter((r) => r.spanHit !== null);
    const within = (k: number) => located.filter((r) => r.spanHit! <= k).length;
    const axes: ModeAxes = {
      snippetMarker: { shown: located.filter((r) => r.snippetHasMarker === true).length, n: located.length },
      spanHit: { n: book.length, at1: within(1), at3: within(3), at5: within(5) },
    };
    const confidence = confidenceAxis(rows);
    if (confidence) axes.confidence = confidence;
    const ms = rows.map((r) => r.durationMs).filter((x): x is number => x !== undefined);
    if (ms.length) axes.latency = { n: ms.length, p50: percentile(ms, 0.5), p95: percentile(ms, 0.95) };
    out[mode] = axes;
  }
  return out;
}

const ratio = (k: number, n: number) => `${k}/${n} (${n === 0 ? "n/a" : (k / n).toFixed(3)})`;

/** Lines for every declared axis: its trend from thresholds.json, then the numbers per mode. */
export function renderAxes(
  axes: Partial<Record<Mode, ModeAxes>>,
  cfg: NonNullable<Thresholds["reportOnlyAxes"]>,
): string[] {
  const entries = Object.entries(axes) as Array<[Mode, ModeAxes]>;
  const perMode: Record<string, (m: Mode, a: ModeAxes) => string> = {
    snippetMarker: (m, a) => `    ${m}: marker shown ${ratio(a.snippetMarker.shown, a.snippetMarker.n)}`,
    spanHit: (m, { spanHit: s }) =>
      `    ${m}: @1 ${ratio(s.at1, s.n)}, @3 ${ratio(s.at3, s.n)}, @5 ${ratio(s.at5, s.n)}`,
    confidence: (m, { confidence: c }) =>
      c
        ? `    ${m}: false-flag ${ratio(c.falseFlagged, c.hit1Positives)}, AUC maxRerank ${c.aucMaxRerank.toFixed(3)}, ` +
          `AUC margin ${c.aucMargin.toFixed(3)} (n=${c.n})`
        : `    ${m}: n/a (no reranked rows)`,
    latency: (m, { latency: l }) =>
      l ? `    ${m}: p50 ${l.p50} ms, p95 ${l.p95} ms (n=${l.n})` : `    ${m}: n/a (no timings)`,
  };
  const lines = ["report-only axes (#363, thresholds.reportOnlyAxes; never gated)"];
  for (const [name, axis] of Object.entries(cfg)) {
    if (name.startsWith("$")) continue;
    lines.push(`  ${name}: trend: ${axis.trend}`);
    const render = perMode[name];
    if (axis.measured === false) lines.push("    not measured by this harness");
    else if (render) lines.push(...entries.map(([m, a]) => render(m, a)));
    // ablation needs both rerank passes: run.ts prints it after `--gate`'s OFF pass
    else if (name === "ablation") lines.push("    printed by `pnpm eval --gate` (needs the rerank on + off passes)");
  }
  return lines;
}

/** Overall Hit@1 / nDCG@10 per mode for the rerank ON and OFF passes side by side. */
export function ablationMatrix(on: EvalReport, off: EvalReport): string[] {
  const cell = (r: EvalReport, m: Mode) => {
    const o = r.overall[m];
    return o ? `${o.hit1.toFixed(3)} / ${o.ndcg10.toFixed(3)}` : "—";
  };
  const modes = [...new Set([...on.meta.modes, ...off.meta.modes])];
  return [
    "ablation (report-only): overall Hit@1 / nDCG@10, modes x rerank",
    "| mode | rerank on | rerank off |",
    "|---|---|---|",
    ...modes.map((m) => `| ${m} | ${cell(on, m)} | ${cell(off, m)} |`),
  ];
}
