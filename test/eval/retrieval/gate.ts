// Mechanical PASS/FAIL gate for `pnpm eval --gate` (#85/#86, D-012 protocol): compares a
// fresh fixture report against thresholds.json + the frozen baseline report. Pure logic —
// run.ts does the file IO and printing. Gates were DECLARED before the build (#85 verdict);
// this module only mechanizes them. The per-query drop diff is a mandatory artifact even
// when the gate is green — every dropped query needs a human explanation in the report doc.

import type { EvalReport, Mode, PerQueryRow, QueryKind } from "./harness.js";
import { mean } from "./stats.js";

/** Shape of thresholds.json (extra $comment keys tolerated). */
export interface Thresholds {
  baselineReport: string;
  nonRegression: Partial<Record<Mode, { maxBrokenHit1Queries: number; negativesFlagged?: number }>>;
  /** Absent → no figure-caption checks (the #357 hash gate reuses evaluateGate without them). */
  figureCaption?: {
    queryCount: { min: number; max: number };
    gatedModes: Mode[];
    measuredUngatedModes?: Mode[];
  } & Partial<Record<Mode, { hit1Min: number; ndcg10Min: number }>>;
  figureNegative?: {
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
   * Score drift vs the baseline report (#325): per-query cosine maxScore must reproduce within an
   * epsilon. The aggregate ε was replaced by listDiff (#358). Absent → no drift check.
   */
  scoreDrift?: {
    /** Max |Δ| on a row's maxScore, matched by query id + mode (unmeasured ε, #364). */
    maxScoreEpsilon: number;
    /** Modes whose maxScore is a cosine (keyword maxScore is bm25 — a different scale). */
    maxScoreModes: Mode[];
  };
  /**
   * Fusion-only tier (#356): a --rerank off run vs its own frozen baseline, because with rerank
   * ON the cross-encoder re-sorts the whole fixture and hides fusion. Absent → no OFF pass.
   */
  fusionOnly?: {
    /** Frozen --rerank off report; set by the freeze commit after the rule commit (D-012). */
    baselineReport?: string;
    rerank: "off";
    nonRegression: Partial<Record<Mode, { maxBrokenHit1Queries: number }>>;
    /** Kinds whose drops are listed but never fail the gate. */
    reportOnlyKinds: QueryKind[];
  };
  /** Top-k list diff vs each tier's baseline (#358); entries in allowFile permit exact new lists. */
  listDiff?: {
    topK: number;
    /** Relative to the retrieval dir; JSON `{ entries: AllowEntry[] }`. */
    allowFile: string;
  };
  /** Golden-set hash check (#392 decision 2): these tiers fail when queries.json moved since their freeze. */
  goldenSet?: {
    tiers: ListDiffTier[];
  };
  /** Tier-0 hash-embedder gate inside `pnpm test` (#357): per-query rank baseline, Hit@1 rule. */
  hashGate?: {
    /** hash-baseline.json, relative to the retrieval dir; set by the freeze commit (D-012). */
    baselineReport?: string;
    nonRegression: Partial<Record<Mode, { maxBrokenHit1Queries: number }>>;
    /** Vitest timeout for one full hash run — the "< 30 s" budget. */
    maxDurationMs: number;
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

/** A baseline row with Hit@1=1 that now misses, plus the current row (absent = MISSING). */
interface BrokenRow {
  base: PerQueryRow;
  cur: PerQueryRow | undefined;
  id: string;
}

/** Baseline Hit@1=1 queries in `mode` that miss (or are missing) in the current run. */
function brokenHit1(current: EvalReport, baseline: EvalReport, mode: Mode): BrokenRow[] {
  const curById = new Map(rowsOf(current, mode).map((r) => [r.id, r]));
  return rowsOf(baseline, mode)
    .filter((b) => b.metrics?.hit1 === 1 && curById.get(b.id)?.metrics?.hit1 !== 1)
    .map((base) => ({ base, cur: curById.get(base.id), id: base.id }));
}

function dropLine(mode: Mode, { base, cur }: BrokenRow, tag = ""): string {
  const now = cur ? `Hit@1=${cur.metrics?.hit1 ?? "?"} top3=[${cur.retrieved.slice(0, 3).join(", ")}]` : "MISSING";
  return `${rowKey(mode, base.id)} (${base.kind})${tag}: baseline Hit@1=1 → now ${now}`;
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
    const broken = brokenHit1(current, baseline, mode);
    for (const b of broken) drops.push(dropLine(mode, b));
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

  if (t.figureCaption) checks.push(...figureCaptionChecks(current, t.figureCaption));
  if (t.figureNegative) {
    checks.push(...figureNegativeChecks(current, t.figureNegative, t.figureCaption?.gatedModes[0] ?? "hybrid"));
  }

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

  return gateResult(checks, drops);
}

/**
 * Fusion-only tier (#356): per-query Hit@1 non-regression of a --rerank off run against the
 * frozen OFF baseline. Report-only kinds (cross-lingual) are listed, never failed.
 */
export function evaluateFusionOnlyGate(
  current: EvalReport,
  baseline: EvalReport,
  cfg: NonNullable<Thresholds["fusionOnly"]>,
): GateResult {
  const checks: GateCheck[] = [];
  const drops: string[] = [];
  // an ON run here would re-sort away the fusion order this tier exists to see
  const isOff = current.meta.rerank.startsWith("off") && current.meta.rerankedRows === 0;
  checks.push({
    name: "fusion-only: run is rerank-off",
    active: true,
    pass: isOff,
    detail: `rerank ${current.meta.rerank}, ${current.meta.rerankedRows} reranked rows`,
  });
  const reportOnly = new Set<string>(cfg.reportOnlyKinds);
  const ids = (rows: BrokenRow[]) => (rows.length ? `: ${rows.map((r) => r.id).join(", ")}` : "");
  for (const mode of MODES) {
    const limit = cfg.nonRegression[mode];
    if (!limit) continue;
    const broken = brokenHit1(current, baseline, mode);
    const gated = broken.filter((b) => !reportOnly.has(b.base.kind));
    const noted = broken.filter((b) => reportOnly.has(b.base.kind));
    for (const b of broken) drops.push(dropLine(mode, b, reportOnly.has(b.base.kind) ? " [report-only]" : ""));
    checks.push({
      name: `fusion-only ${mode}: broken Hit@1 queries`,
      active: true,
      pass: gated.length <= limit.maxBrokenHit1Queries,
      detail: `${gated.length} broken (allowed ${limit.maxBrokenHit1Queries})${ids(gated)}`,
    });
    for (const kind of cfg.reportOnlyKinds) {
      const ofKind = noted.filter((b) => b.base.kind === kind);
      checks.push({
        name: `fusion-only ${mode}: ${kind} (report-only)`,
        active: false,
        pass: true,
        detail: `${ofKind.length} broken${ids(ofKind)}`,
      });
    }
  }
  return gateResult(checks, drops);
}

/** figure-caption kind: gated modes vs declared floors; diagnostics excluded (#85 item 4). */
function figureCaptionChecks(current: EvalReport, fig: NonNullable<Thresholds["figureCaption"]>): GateCheck[] {
  const checks: GateCheck[] = [];
  const gatedFig = (mode: Mode) =>
    rowsOf(current, mode).filter((r) => r.kind === "figure-caption" && r.diagnostic !== true);
  const figCount = gatedFig(current.meta.modes[0] ?? "hybrid").length;
  checks.push({
    name: "figure-caption: gated query count",
    active: true,
    pass: figCount >= fig.queryCount.min && figCount <= fig.queryCount.max,
    detail: `${figCount} gated queries (want ${fig.queryCount.min}-${fig.queryCount.max})`,
  });
  for (const mode of fig.gatedModes) {
    const floors = fig[mode];
    const rows = gatedFig(mode);
    const hit1 = mean(rows.map((r) => r.metrics?.hit1 ?? 0));
    const ndcg = mean(rows.map((r) => r.metrics?.ndcg10 ?? 0));
    checks.push({
      name: `figure-caption ${mode}`,
      active: true,
      pass: floors !== undefined && hit1 >= floors.hit1Min && ndcg >= floors.ndcg10Min,
      detail: `Hit@1 ${hit1.toFixed(3)} (≥${floors?.hit1Min}), nDCG@10 ${ndcg.toFixed(3)} (≥${floors?.ndcg10Min})`,
    });
  }
  for (const mode of fig.measuredUngatedModes ?? []) {
    const rows = gatedFig(mode);
    if (rows.length === 0) continue;
    checks.push({
      name: `figure-caption ${mode} (measured, ungated)`,
      active: false,
      pass: true,
      detail: `Hit@1 ${mean(rows.map((r) => r.metrics?.hit1 ?? 0)).toFixed(3)}, nDCG@10 ${mean(rows.map((r) => r.metrics?.ndcg10 ?? 0)).toFixed(3)}`,
    });
  }

  return checks;
}

/**
 * figure-negative kind: structural count is active now; the flagged-rate gate arms only once
 * the figures cosine floor is calibrated (figureNegative.active).
 */
function figureNegativeChecks(
  current: EvalReport,
  neg: NonNullable<Thresholds["figureNegative"]>,
  mode: Mode,
): GateCheck[] {
  const checks: GateCheck[] = [];
  const figNegs = rowsOf(current, mode).filter((r) => r.kind === "figure-negative");
  checks.push({
    name: "figure-negative: query count",
    active: true,
    pass: figNegs.length >= neg.queryCount.min && figNegs.length <= neg.queryCount.max,
    detail: `${figNegs.length} queries (want ${neg.queryCount.min}-${neg.queryCount.max})`,
  });
  const negActive = neg.active === true;
  const flaggedRate = figNegs.length === 0 ? 0 : figNegs.filter((r) => r.flagged === true).length / figNegs.length;
  checks.push({
    name: `figure-negative: flagged rate${negActive ? "" : " (inactive — floor uncalibrated)"}`,
    active: negActive,
    pass: flaggedRate >= neg.flaggedRate,
    detail: `flagged ${flaggedRate.toFixed(2)} (need ${neg.flaggedRate})`,
  });

  return checks;
}

const fmt = (n: number) => n.toFixed(4);

/** Per-query maxScore drift vs the baseline (#325); every baseline cosine row must be matched. */
function scoreDriftChecks(
  current: EvalReport,
  baseline: EvalReport,
  cfg: NonNullable<Thresholds["scoreDrift"]>,
): GateCheck[] {
  // Every baseline cosine row must be matched: an empty or partial compare would pass while
  // seeing nothing (a renamed query, a run that stopped recording maxScore).
  const curScore = new Map(current.perQuery.map((r) => [rowKey(r.mode, r.id), r.maxScore]));
  const eligible = baseline.perQuery.filter(
    (r) => cfg.maxScoreModes.includes(r.mode) && typeof r.maxScore === "number",
  );
  const missing: string[] = [];
  const shifts = eligible
    .flatMap((r) => {
      const key = rowKey(r.mode, r.id);
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

/** Gate tiers: ON pass, OFF fusion pass, and the tier-0 hash gate inside `pnpm test`. */
export const LIST_DIFF_TIERS = ["on", "fusionOnly", "hash"] as const;

/** Which gate tier an allow entry (or a golden-set check) belongs to. */
export type ListDiffTier = (typeof LIST_DIFF_TIERS)[number];

/** How each tier's baseline is re-frozen; the hash tier has a one-command freeze (#392 decision 1). */
const REFREEZE: Record<ListDiffTier, string> = {
  hash: "re-freeze with `pnpm eval:hash-freeze` (rule first, D-012)",
  on: "re-freeze thresholds.json baselineReport with a new `pnpm eval` run (rule first, D-012)",
  fusionOnly: "re-freeze thresholds.json fusionOnly.baselineReport with a new `pnpm eval` run (rule first, D-012)",
};

/** The re-freeze instruction a failing check prints for `tier`. */
export function refreezeHint(tier: ListDiffTier): string {
  return REFREEZE[tier];
}

/** Stable `mode/id` key of a per-query row across reports and allow entries. */
export const rowKey = (mode: Mode, id: string): string => `${mode}/${id}`;

/** One intended list change: exactly this new top-k list for this (tier, mode, id), with a reason. */
export interface AllowEntry {
  tier: ListDiffTier;
  mode: Mode;
  id: string;
  retrieved: string[];
  reason: string;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** "changed at rank r: was → now" for the first differing position of two lists. */
function firstDiff(was: string[], now: string[], topK: number): string {
  const i = was.findIndex((k, j) => k !== now[j]);
  const at = i === -1 ? was.length : i;
  return `top-${topK} changed at rank ${at + 1}: ${was[at] ?? "(end)"} → ${now[at] ?? "(end)"}`;
}

/**
 * Top-k list diff (#358): every baseline row must reproduce its top-k `retrieved` list exactly,
 * or match an allow entry naming that exact new list. Catches rank moves Hit@1 can't see
 * (a 2→3 shift) and makes gains ratchet. Missing rows count as changed.
 */
export function evaluateListDiff(
  current: EvalReport,
  baseline: EvalReport,
  opts: { tier: ListDiffTier; topK: number; allow: AllowEntry[] },
): GateResult {
  const entries = opts.allow.filter((e) => e.tier === opts.tier);
  const allowBy = new Map(entries.map((e) => [rowKey(e.mode, e.id), e]));
  const used = new Set<string>();
  const curBy = new Map(current.perQuery.map((r) => [rowKey(r.mode, r.id), r]));
  const drops: string[] = [];
  const unallowed: string[] = [];
  let changed = 0;
  for (const b of baseline.perQuery) {
    const k = rowKey(b.mode, b.id);
    const was = b.retrieved.slice(0, opts.topK);
    const cur = curBy.get(k);
    const now = cur?.retrieved.slice(0, opts.topK);
    if (now && sameList(was, now)) continue;
    changed++;
    const entry = allowBy.get(k);
    if (now && entry && entry.reason.trim() !== "" && sameList(entry.retrieved.slice(0, opts.topK), now)) {
      used.add(k);
      continue;
    }
    unallowed.push(k);
    drops.push(`${k} (${b.kind}): ${now ? firstDiff(was, now, opts.topK) : "MISSING"}`);
  }
  const noReason = entries.filter((e) => e.reason.trim() === "").map((e) => rowKey(e.mode, e.id));
  const unused = entries.map((e) => rowKey(e.mode, e.id)).filter((k) => !used.has(k));
  // a stale entry stays armed: a later regression to exactly that list would pass silently
  const stale = unused.filter((k) => !noReason.includes(k));
  const entriesDetail = noReason.length
    ? `${entries.length} entries, ${noReason.length} without a reason: ${noReason.join(", ")}`
    : stale.length
      ? `${entries.length} entries, ${stale.length} stale (allow no current change — delete them): ${stale.join(", ")}`
      : `${entries.length} entries, all with a reason`;
  // the hash tier re-freezes in one command, so its failure says how (#392 decision 1)
  const hashHint = opts.tier === "hash" ? ` — intended? ${refreezeHint("hash")}` : "";
  const checks: GateCheck[] = [
    {
      name: `top-${opts.topK} list diff (${opts.tier})`,
      active: true,
      pass: unallowed.length === 0,
      detail:
        `${changed} changed, ${used.size} allowed (of ${baseline.perQuery.length} rows)` +
        (unallowed.length ? `: ${unallowed.join(", ")}${hashHint}` : ""),
    },
    {
      name: `allow-file entries (${opts.tier})`,
      active: true,
      pass: noReason.length === 0 && stale.length === 0,
      detail: entriesDetail,
    },
    {
      // an entry that allows nothing is stale (re-frozen baseline, or the change never happened)
      name: `allow-file unused entries (${opts.tier})`,
      active: false,
      pass: true,
      detail: `${unused.length} unused${unused.length ? `: ${unused.join(", ")}` : ""}`,
    },
  ];
  return gateResult(checks, drops);
}

/** A GateResult from its checks: passes when every ACTIVE check passes. */
export function gateResult(checks: GateCheck[], drops: string[]): GateResult {
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
