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
  const solved = new Map<string, boolean>();
  for (const row of report.perQuery) {
    if (!row.metrics) continue;
    solved.set(row.id, (solved.get(row.id) ?? true) && row.metrics.hit1 === 1);
  }
  const positives = solved.size;
  const solvedByAll = [...solved.values()].filter(Boolean).length;
  return { positives, solvedByAll, share: positives === 0 ? 0 : round4(solvedByAll / positives) };
}

/**
 * Warning line when the shipped config (rerank ON, hybrid) reaches Hit@1 >= SATURATION_HIT1;
 * undefined otherwise. Rerank-off runs isolate fusion, so they never trigger it.
 */
export function saturationWarning(report: EvalReport): string | undefined {
  if (report.meta.rerank === "off") return undefined;
  const hit1 = report.overall.hybrid?.hit1;
  if (hit1 === undefined || hit1 < SATURATION_HIT1) return undefined;
  return (
    `WARNING: eval saturated — rerank-ON hybrid Hit@1 ${hit1.toFixed(3)} >= ${SATURATION_HIT1}; ` +
    "optimise cost/latency or add harder queries (#365)"
  );
}
