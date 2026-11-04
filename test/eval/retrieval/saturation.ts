// Eval saturation signals for `pnpm eval` (#365) — stub; implemented in the GREEN commit.

import type { EvalReport } from "./harness.js";

/** Positives solved at Hit@1 by every mode in the run. */
export interface Headroom {
  positives: number;
  solvedByAll: number;
  share: number;
}

/** Stub. */
export function headroom(_report: EvalReport): Headroom {
  return { positives: -1, solvedByAll: -1, share: -1 };
}

/** Stub. */
export function saturationWarning(_report: EvalReport): string | undefined {
  return undefined;
}
