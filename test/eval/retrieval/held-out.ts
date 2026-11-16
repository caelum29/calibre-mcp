// Held-out report section (#632): every fixture `pnpm eval` run prints the frozen held-out
// queries' numbers apart from the tuned ones. Report-only — no gate, baseline or list diff reads
// it, and the report JSON shape doesn't change. A set of 20 is noisy, so every number carries
// its 95% percentile bootstrap interval (fixed seed, stats.ts).

import { heldOutIds, isNegativeKind, type EvalReport } from "./harness.js";
import { mean, pairedBootstrapCI, SEED } from "./stats.js";

const f3 = (n: number) => n.toFixed(3);

/** Mean with its bootstrap interval, e.g. `0.500 [0.000, 1.000]`. */
function withCi(xs: number[]): string {
  const [lo, hi] = pairedBootstrapCI(xs, { seed: SEED });
  return `${f3(mean(xs))} [${f3(lo)}, ${f3(hi)}]`;
}

/**
 * The held-out lines of one fixture report: per mode, n scored held-out rows, Hit@1 and nDCG@10
 * with intervals, and how many held-out negatives were flagged. Empty for a live run.
 */
export function heldOutLines(report: EvalReport, heldOut: Set<string> = heldOutIds()): string[] {
  if (report.meta.live) return [];
  const lines = [
    `held-out (#632): ${heldOut.size} frozen queries, report-only; 95% percentile bootstrap CI (seed 0x${SEED.toString(16)})`,
  ];
  for (const mode of report.meta.modes) {
    const rows = report.perQuery.filter((r) => r.mode === mode && heldOut.has(r.id));
    const scored = rows.filter((r) => r.metrics !== undefined).map((r) => r.metrics!);
    const negs = rows.filter((r) => isNegativeKind(r.kind));
    lines.push(
      `held-out ${mode}: n ${scored.length}, Hit@1 ${withCi(scored.map((x) => x.hit1))}, ` +
        `nDCG@10 ${withCi(scored.map((x) => x.ndcg10))}; negatives flagged ${negs.filter((r) => r.flagged === true).length}/${negs.length}`,
    );
  }
  return lines;
}
