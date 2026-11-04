// Up-front guards for `pnpm eval --gate` (#356 review): bad flags and missing baselines fail
// before the ~8 min ON pass, and no run may overwrite a frozen baseline report.

import path from "node:path";
import type { Thresholds } from "./gate.js";
import type { EvalReport } from "./harness.js";

/** Flag combinations the gate refuses, checked before any pass runs. */
export function checkGateArgs(args: { gate: boolean; live: boolean; rerank?: string }): void {
  if (!args.gate) return;
  if (args.live) throw new Error("--gate is fixture-only: the live diff is a triage artifact, never a gate (#85).");
  // the gate picks the rerank setting per pass (ON, then OFF), so a user override would be ignored
  if (args.rerank !== undefined) throw new Error("--gate runs both rerank ON and OFF passes itself; drop --rerank.");
}

/** Both frozen baselines the gate compares against; `off` only when thresholds declare fusionOnly. */
export interface GateBaselines {
  on: EvalReport;
  off?: EvalReport;
}

/**
 * Load every baseline the gate needs, so a missing or unreadable one fails before any pass.
 * `read` gets the path relative to the retrieval dir (as written in thresholds.json).
 */
export function loadGateBaselines(t: Thresholds, read: (rel: string) => string): GateBaselines {
  const load = (rel: string, key: string): EvalReport => {
    try {
      return JSON.parse(read(rel)) as EvalReport;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(`thresholds.${key} "${rel}" is unreadable: ${why}`);
    }
  };
  const on = load(t.baselineReport, "baselineReport");
  if (!t.fusionOnly) return { on };
  const offRel = t.fusionOnly.baselineReport;
  if (!offRel) throw new Error("thresholds.fusionOnly has no baselineReport — freeze one first (D-012).");
  return { on, off: load(offRel, "fusionOnly.baselineReport") };
}

/** Absolute paths of every baseline thresholds.json references (resolved against `baseDir`). */
export function baselinePaths(t: Thresholds, baseDir: string): string[] {
  const rels = [t.baselineReport, t.fusionOnly?.baselineReport].filter((p): p is string => Boolean(p));
  return rels.map((rel) => path.resolve(baseDir, rel));
}

/**
 * Throw if `target` is a frozen baseline: a run at the baseline's own date+sha would otherwise
 * write the same filename and silently replace it. Also covers the .md companion.
 */
export function refuseBaselineOverwrite(target: string, protectedPaths: string[]): void {
  const abs = path.resolve(target);
  const guarded = new Set(protectedPaths.flatMap((p) => [p, p.replace(/\.json$/, ".md")]));
  if (guarded.has(abs)) {
    throw new Error(`refusing to overwrite frozen baseline ${abs} — pass --out-dir or --tag to write elsewhere`);
  }
}
