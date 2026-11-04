// Eval saturation signals for `pnpm eval` (#365). A suite where every config already solves most
// queries can't tell tuning changes apart, so the CLI prints headroom and warns near the ceiling.

import type { EvalReport } from "./harness.js";
import { round4 } from "./metrics.js";

/** Anthropic eval guidance: a baseline near 95% means optimise cost/latency, not quality. */
export const SATURATION_HIT1 = 0.95;

/** Positives solved at Hit@1 by every mode in the run. */
export interface Headroom {
  /** Distinct queries with rank metrics (negatives excluded). */
  positives: number;
  /** Of those, how many hit@1 in every mode the run measured. */
  solvedByAll: number;
  /** solvedByAll / positives, 4 decimals; 0 when there are no positives. */
  share: number;
}

/**
 * Share of positive queries every mode in this run solves at Hit@1 — those queries carry no
 * signal for comparing the run's configs, so a high share means little headroom.
 */
export function headroom(report: EvalReport): Headroom {
  // per query: the modes it hit@1 in; a mode with no row for the query counts as a miss
  const hitModes = new Map<string, Set<string>>();
  for (const row of report.perQuery) {
    if (!row.metrics) continue;
    const hits = hitModes.get(row.id) ?? new Set<string>();
    if (row.metrics.hit1 === 1) hits.add(row.mode);
    hitModes.set(row.id, hits);
  }
  const positives = hitModes.size;
  const solvedByAll = [...hitModes.values()].filter((hits) => report.meta.modes.every((m) => hits.has(m))).length;
  return { positives, solvedByAll, share: positives === 0 ? 0 : round4(solvedByAll / positives) };
}

/**
 * Warning line when the shipped config (rerank ON, hybrid) reaches Hit@1 >= SATURATION_HIT1;
 * undefined otherwise. Fusion-only runs never trigger it: `--rerank off`, the harness's
 * "off (no reranker wired)" label, and ON-labelled runs where the model failed to load
 * (rerankedRows 0) all still have fusion headroom.
 */
export function saturationWarning(report: EvalReport): string | undefined {
  if (report.meta.rerank.startsWith("off") || report.meta.rerankedRows === 0) return undefined;
  const hit1 = report.overall.hybrid?.hit1;
  if (hit1 === undefined || hit1 < SATURATION_HIT1) return undefined;
  return (
    `WARNING: eval saturated — rerank-ON hybrid Hit@1 ${hit1.toFixed(3)} >= ${SATURATION_HIT1}; ` +
    "optimise cost/latency or add harder queries (#365)"
  );
}

/**
 * The CLI's saturation lines for a finished run. Live runs score unverified labels, so both
 * signals are skipped there rather than reported as if they meant something.
 */
export function saturationLines(report: EvalReport): string[] {
  if (report.meta.live) return ["headroom: skipped on --live (unverified labels)"];
  const hr = headroom(report);
  const warning = saturationWarning(report);
  return [
    `headroom: ${hr.solvedByAll}/${hr.positives} positives solved at Hit@1 by every mode (${(hr.share * 100).toFixed(1)}%)`,
    ...(warning ? [warning] : []),
  ];
}
