// Mechanical PASS/FAIL gate for `pnpm eval --gate` (#85/#86, D-012 protocol): compares a
// fresh fixture report against thresholds.json + the frozen baseline report. Pure logic —
// run.ts does the file IO and printing. Gates were DECLARED before the build (#85 verdict);
// this module only mechanizes them. The per-query drop diff is a mandatory artifact even
// when the gate is green — every dropped query needs a human explanation in the report doc.

import type { EvalReport, Mode, PerQueryRow } from "./harness.js";

/** Shape of thresholds.json (extra $comment keys tolerated). */
export interface Thresholds {
  baselineReport: string;
  nonRegression: Partial<
    Record<Mode, { maxBrokenHit1Queries: number; negativesFlagged?: number }>
  >;
  figureCaption: {
    queryCount: { min: number; max: number };
    gatedModes: Mode[];
    measuredUngatedModes?: Mode[];
  } & Partial<Record<Mode, { hit1Min: number; ndcg10Min: number }>>;
  figureNegative: {
    /** Flips to true once the figures cosine floor is calibrated (#85 two-tier protocol). */
    active?: boolean;
    queryCount: { min: number; max: number };
    flaggedRate: number;
    positivesZeroedByFloor: number;
  };
}

export interface GateCheck {
  name: string;
  /** Inactive checks are measured + printed but never fail the gate. */
  active: boolean;
  pass: boolean;
  detail: string;
}

export interface GateResult {
  /** True when every ACTIVE check passes. */
  pass: boolean;
  checks: GateCheck[];
  /** Baseline-passed queries that now fail Hit@1, per mode — the mandatory diff artifact. */
  drops: string[];
}

const MODES: Mode[] = ["hybrid", "vector", "keyword"];

function rowsOf(report: EvalReport, mode: Mode): PerQueryRow[] {
  return report.perQuery.filter((r) => r.mode === mode);
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function evaluateGate(current: EvalReport, baseline: EvalReport, t: Thresholds): GateResult {
  const checks: GateCheck[] = [];
  const drops: string[] = [];

  // 1. Non-regression vs baseline: per-query Hit@1, text kinds only (figure kinds have no
  //    baseline rows). A query missing from the current run counts as broken — a silently
  //    deleted query must not read as a pass.
  for (const mode of MODES) {
    const cfg = t.nonRegression[mode];
    if (!cfg) continue;
    const curById = new Map(rowsOf(current, mode).map((r) => [r.id, r]));
    const passedInBaseline = rowsOf(baseline, mode).filter((r) => r.metrics?.hit1 === 1);
    const broken = passedInBaseline.filter((b) => curById.get(b.id)?.metrics?.hit1 !== 1);
    for (const b of broken) {
      const cur = curById.get(b.id);
      drops.push(
        `${mode}/${b.id} (${b.kind}): baseline Hit@1=1 → now ${cur ? `Hit@1=${cur.metrics?.hit1 ?? "?"} top3=[${cur.retrieved.slice(0, 3).join(", ")}]` : "MISSING"}`,
      );
    }
    checks.push({
      name: `non-regression ${mode}: broken Hit@1 queries`,
      active: true,
      pass: broken.length <= cfg.maxBrokenHit1Queries,
      detail: `${broken.length} broken (allowed ${cfg.maxBrokenHit1Queries})${broken.length ? `: ${broken.map((b) => b.id).join(", ")}` : ""}`,
    });
    if (cfg.negativesFlagged !== undefined) {
      const negs = rowsOf(current, mode).filter((r) => r.kind === "negative");
      const flagged = negs.filter((r) => r.flagged === true).length;
      checks.push({
        name: `non-regression ${mode}: negatives flagged`,
        active: true,
        pass: flagged >= cfg.negativesFlagged,
        detail: `${flagged}/${negs.length} flagged (need ${cfg.negativesFlagged})`,
      });
    }
  }

  // 2. figure-caption kind: gated modes vs declared floors; diagnostics excluded (#85 item 4).
  const gatedFig = (mode: Mode) =>
    rowsOf(current, mode).filter((r) => r.kind === "figure-caption" && r.diagnostic !== true);
  const figCount = gatedFig(current.meta.modes[0] ?? "hybrid").length;
  checks.push({
    name: "figure-caption: gated query count",
    active: true,
    pass: figCount >= t.figureCaption.queryCount.min && figCount <= t.figureCaption.queryCount.max,
    detail: `${figCount} gated queries (want ${t.figureCaption.queryCount.min}-${t.figureCaption.queryCount.max})`,
  });
  for (const mode of t.figureCaption.gatedModes) {
    const floors = t.figureCaption[mode];
    const rows = gatedFig(mode);
    const hit1 = avg(rows.map((r) => r.metrics?.hit1 ?? 0));
    const ndcg = avg(rows.map((r) => r.metrics?.ndcg10 ?? 0));
    checks.push({
      name: `figure-caption ${mode}`,
      active: true,
      pass: floors !== undefined && hit1 >= floors.hit1Min && ndcg >= floors.ndcg10Min,
      detail: `Hit@1 ${hit1.toFixed(3)} (≥${floors?.hit1Min}), nDCG@10 ${ndcg.toFixed(3)} (≥${floors?.ndcg10Min})`,
    });
  }
  for (const mode of t.figureCaption.measuredUngatedModes ?? []) {
    const rows = gatedFig(mode);
    if (rows.length === 0) continue;
    checks.push({
      name: `figure-caption ${mode} (measured, ungated)`,
      active: false,
      pass: true,
      detail: `Hit@1 ${avg(rows.map((r) => r.metrics?.hit1 ?? 0)).toFixed(3)}, nDCG@10 ${avg(rows.map((r) => r.metrics?.ndcg10 ?? 0)).toFixed(3)}`,
    });
  }

  // 3. figure-negative kind: structural count is active now; the flagged-rate gate arms only
  //    once the figures cosine floor is calibrated (thresholds.figureNegative.active).
  const figNegs = rowsOf(current, t.figureCaption.gatedModes[0] ?? "hybrid").filter(
    (r) => r.kind === "figure-negative",
  );
  checks.push({
    name: "figure-negative: query count",
    active: true,
    pass:
      figNegs.length >= t.figureNegative.queryCount.min &&
      figNegs.length <= t.figureNegative.queryCount.max,
    detail: `${figNegs.length} queries (want ${t.figureNegative.queryCount.min}-${t.figureNegative.queryCount.max})`,
  });
  const negActive = t.figureNegative.active === true;
  const flaggedRate = figNegs.length === 0 ? 0 : figNegs.filter((r) => r.flagged === true).length / figNegs.length;
  checks.push({
    name: `figure-negative: flagged rate${negActive ? "" : " (inactive — floor uncalibrated)"}`,
    active: negActive,
    pass: flaggedRate >= t.figureNegative.flaggedRate,
    detail: `flagged ${flaggedRate.toFixed(2)} (need ${t.figureNegative.flaggedRate})`,
  });

  return { pass: checks.every((c) => !c.active || c.pass), checks, drops };
}

/** Render the gate outcome for the CLI (stdout) — one line per check + the drop diff. */
export function renderGate(result: GateResult): string {
  const lines: string[] = [];
  for (const c of result.checks) {
    const mark = c.active ? (c.pass ? "PASS" : "FAIL") : "info";
    lines.push(`[${mark}] ${c.name} — ${c.detail}`);
  }
  if (result.drops.length) {
    lines.push("");
    lines.push("Per-query drops vs baseline (each needs an explanation in the report doc):");
    for (const d of result.drops) lines.push(`  - ${d}`);
  }
  lines.push("");
  lines.push(result.pass ? "GATE: PASS" : "GATE: FAIL");
  return lines.join("\n");
}
