// Mechanical PASS/FAIL gate for `pnpm eval --gate` (#85/#86, D-012 protocol): compares a
// fresh fixture report against thresholds.json + the frozen baseline report. Pure logic —
// run.ts does the file IO and printing. Gates were DECLARED before the build (#85 verdict);
// this module only mechanizes them. The per-query drop diff is a mandatory artifact even
// when the gate is green — every dropped query needs a human explanation in the report doc.

import type { EvalReport, Mode, PerQueryRow } from "./harness.js";
import type { AggregateMetrics } from "./metrics.js";

/** Shape of thresholds.json (extra $comment keys tolerated). */
export interface Thresholds {
  baselineReport: string;
  nonRegression: Partial<Record<Mode, { maxBrokenHit1Queries: number; negativesFlagged?: number }>>;
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
  /** #102 heading front-matter trap queries (fixture 117): per-mode min Hit@1 count. */
  headingFrontMatter?: {
    queryIds: string[];
    minHit1Queries: Partial<Record<Mode, number>>;
  };
  /**
   * Score drift vs the baseline report (#325): Hit@1 non-regression can't see a rank or score
   * shift that keeps every top hit, so aggregates and per-query cosine maxScore must also
   * reproduce within an epsilon. Absent → no drift checks.
   */
  scoreDrift?: {
    /** Max |Δ| on overall/ruInvolved hit1, recall5, mrr, ndcg10 (per mode). */
    metricEpsilon: number;
    /** Max |Δ| on a row's maxScore, matched by query id + mode. */
    maxScoreEpsilon: number;
    /** Modes whose maxScore is a cosine (keyword maxScore is bm25 — a different scale). */
    maxScoreModes: Mode[];
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
    pass: figNegs.length >= t.figureNegative.queryCount.min && figNegs.length <= t.figureNegative.queryCount.max,
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

  // 4. heading front-matter trap (#102): new queries the baseline predates, so the
  //    non-regression diff above can't see them. Missing rows count as misses.
  const hfm = t.headingFrontMatter;
  if (hfm) {
    for (const mode of MODES) {
      const min = hfm.minHit1Queries[mode];
      if (min === undefined) continue;
      const byId = new Map(rowsOf(current, mode).map((r) => [r.id, r]));
      const missed = hfm.queryIds.filter((id) => byId.get(id)?.metrics?.hit1 !== 1);
      const hits = hfm.queryIds.length - missed.length;
      checks.push({
        name: `heading front-matter ${mode}: Hit@1 queries`,
        active: true,
        pass: hits >= min,
        detail: `${hits}/${hfm.queryIds.length} (need ${min})${missed.length ? `; missed: ${missed.join(", ")}` : ""}`,
      });
    }
  }

  if (t.scoreDrift) checks.push(...scoreDriftChecks(current, baseline, t.scoreDrift));

  return { pass: checks.every((c) => !c.active || c.pass), checks, drops };
}

const AGG_KEYS = ["hit1", "recall5", "mrr", "ndcg10"] as const;
const fmt = (n: number) => n.toFixed(4);

/** Aggregate + per-query maxScore drift vs the baseline (#325). Baseline-only rows/keys count. */
function scoreDriftChecks(
  current: EvalReport,
  baseline: EvalReport,
  cfg: NonNullable<Thresholds["scoreDrift"]>,
): GateCheck[] {
  const moved: string[] = [];
  const sections = [
    ["overall", current.overall, baseline.overall],
    ["ruInvolved", current.ruInvolved, baseline.ruInvolved],
  ] as const;
  for (const [label, cur, base] of sections) {
    for (const mode of MODES) {
      const b: AggregateMetrics | undefined = base[mode];
      if (!b) continue;
      const c = cur[mode];
      if (!c) {
        moved.push(`${label} ${mode} MISSING`);
        continue;
      }
      for (const k of AGG_KEYS) {
        if (Math.abs(c[k] - b[k]) > cfg.metricEpsilon) moved.push(`${label} ${mode} ${k} ${fmt(b[k])} → ${fmt(c[k])}`);
      }
    }
  }

  // Every baseline cosine row must be matched: an empty or partial compare would pass while
  // seeing nothing (a renamed query, a run that stopped recording maxScore).
  const curScore = new Map(current.perQuery.map((r) => [`${r.mode}/${r.id}`, r.maxScore]));
  const eligible = baseline.perQuery.filter(
    (r) => cfg.maxScoreModes.includes(r.mode) && typeof r.maxScore === "number",
  );
  const missing: string[] = [];
  const shifts = eligible
    .flatMap((r) => {
      const key = `${r.mode}/${r.id}`;
      const now = curScore.get(key);
      if (typeof now === "number") return [{ key, was: r.maxScore!, now }];
      missing.push(key);
      return [];
    })
    .map((s) => ({ ...s, delta: Math.abs(s.now - s.was) }))
    .sort((a, b) => b.delta - a.delta);
  const over = shifts.filter((s) => s.delta > cfg.maxScoreEpsilon);
  const worst = shifts[0];
  const complete = eligible.length > 0 && missing.length === 0;

  return [
    {
      name: "score drift: aggregate metrics",
      active: true,
      pass: moved.length === 0,
      detail: moved.length
        ? `${moved.length} beyond ±${cfg.metricEpsilon}: ${moved.join("; ")}`
        : `all within ±${cfg.metricEpsilon}`,
    },
    {
      name: "score drift: per-query maxScore",
      active: true,
      pass: complete && over.length === 0,
      detail: !complete
        ? `only ${shifts.length}/${eligible.length} baseline rows matched${missing.length ? `; missing: ${missing.sort().join(", ")}` : ""}`
        : over.length && worst
          ? `${over.length} beyond ±${cfg.maxScoreEpsilon}; worst ${worst.key} ${fmt(worst.was)} → ${fmt(worst.now)}`
          : `${shifts.length} rows within ±${cfg.maxScoreEpsilon}${worst ? ` (max |Δ| ${worst.delta.toFixed(4)})` : ""}`,
    },
  ];
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
