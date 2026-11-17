// Up-front guards for `pnpm eval --gate` (#356 review): bad flags and missing baselines fail
// before the ~8 min ON pass, and no run may overwrite a frozen baseline report.

import path from "node:path";
import {
  LIST_DIFF_TIERS,
  PLATFORM_DRIFT_TIERS,
  rowKey,
  type AllowEntry,
  type GateRule,
  type ListDiffTier,
  type PlatformDriftEntry,
  type Thresholds,
} from "./gate.js";
import { ALL_MODES, type EvalReport, type Mode, type RerankOptions } from "./harness.js";

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

/**
 * Read and shape-check the listDiff allow-file up front, so a malformed entry fails before any
 * pass instead of crashing mid-gate. Empty reasons are left to the gate (a failed check).
 */
export function loadAllowEntries(
  cfg: NonNullable<Thresholds["listDiff"]>,
  read: (rel: string) => string,
): AllowEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(read(cfg.allowFile));
  } catch (err) {
    throw new Error(
      `thresholds.listDiff.allowFile "${cfg.allowFile}" is unreadable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error(`thresholds.listDiff.allowFile "${cfg.allowFile}" needs an "entries" array`);
  }
  const seen = new Set<string>();
  entries.forEach((e: unknown, i) => {
    const bad = (why: string) => new Error(`${cfg.allowFile} entry #${i}: ${why}`);
    if (typeof e !== "object" || e === null) throw bad("must be an object");
    const r = e as Record<string, unknown>;
    if (!LIST_DIFF_TIERS.includes(r.tier as ListDiffTier))
      throw bad(`tier must be one of ${LIST_DIFF_TIERS.join(", ")}`);
    if (!ALL_MODES.includes(r.mode as Mode)) throw bad(`mode must be one of ${ALL_MODES.join(", ")}`);
    if (typeof r.id !== "string" || r.id === "") throw bad("id must be a non-empty string");
    if (!Array.isArray(r.retrieved) || r.retrieved.some((k) => typeof k !== "string")) {
      throw bad("retrieved must be an array of result keys");
    }
    // an empty reason is reported by the gate itself; a non-string can't be checked at all
    if (typeof r.reason !== "string") throw bad("reason must be a string");
    const k = `${r.tier}/${rowKey(r.mode as Mode, r.id)}`;
    // last-wins would silently drop one of two intended lists
    if (seen.has(k)) throw bad(`duplicate entry for ${k}`);
    seen.add(k);
  });
  return entries as AllowEntry[];
}

/**
 * Consistency of allow entries against the frozen baselines, cheap enough for `pnpm test`
 * (#389): the model gate would otherwise be the first to notice an entry for a row that doesn't
 * exist or one that allows the baseline's own list (stale). Returns one problem per bad entry.
 */
export function checkAllowEntries(
  entries: AllowEntry[],
  baselines: Partial<Record<ListDiffTier, EvalReport>>,
  topK: number,
): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    const at = `${e.tier}/${rowKey(e.mode, e.id)}`;
    const base = baselines[e.tier];
    if (!base) {
      problems.push(`${at}: no baseline loaded for tier ${e.tier}`);
      continue;
    }
    const row = base.perQuery.find((r) => r.mode === e.mode && r.id === e.id);
    if (!row) problems.push(`${at}: no such row in the ${e.tier} baseline`);
    else if (row.retrieved.slice(0, topK).join(",") === e.retrieved.slice(0, topK).join(",")) {
      problems.push(`${at}: allows the baseline's own top-${topK} list (stale entry)`);
    }
    if (e.reason.trim() === "") problems.push(`${at}: empty reason`);
  }
  return problems;
}

/**
 * Pick the gate rule from the platform (#364): `linux` with a declared `thresholds.linux` block
 * gets the tolerant Linux rule, anything else the exact rule. The block is shape-checked on every
 * platform, so a malformed entry fails on a macOS run before it reaches the nightly.
 */
export function gateRuleFor(platform: string, t: Thresholds): GateRule {
  const linux = t.linux;
  if (linux) checkLinuxBlock(linux);
  if (platform !== "linux" || !linux) return { name: "exact", listDiffBlocking: true, platformDrift: [] };
  return { name: "linux", listDiffBlocking: false, platformDrift: linux.platformDrift };
}

const LINUX_KEYS = ["$comment", "listDiff", "platformDrift"];

/**
 * Shape-check the whole `thresholds.linux` block: a misspelled key would otherwise drop every
 * drift entry, and a misspelled listDiff mode would still read as report-only.
 */
function checkLinuxBlock(linux: NonNullable<Thresholds["linux"]>): void {
  const unknown = Object.keys(linux).filter((k) => !LINUX_KEYS.includes(k));
  if (unknown.length) {
    throw new Error(`thresholds.linux has unknown key ${unknown.join(", ")} (allowed: ${LINUX_KEYS.join(", ")})`);
  }
  const mode: unknown = linux.listDiff;
  if (mode !== "report") {
    throw new Error(
      `thresholds.linux.listDiff must be "report" (got ${mode === undefined ? "undefined" : JSON.stringify(mode)})`,
    );
  }
  checkPlatformDrift(linux.platformDrift);
}

/** Shape-check `thresholds.linux.platformDrift`; throws naming the first bad entry. */
function checkPlatformDrift(entries: unknown): asserts entries is PlatformDriftEntry[] {
  const at = "thresholds.linux.platformDrift";
  if (!Array.isArray(entries)) throw new Error(`${at} must be an array`);
  const seen = new Set<string>();
  entries.forEach((e: unknown, i) => {
    const bad = (why: string) => new Error(`${at} #${i}: ${why}`);
    if (typeof e !== "object" || e === null) throw bad("must be an object");
    const r = e as Record<string, unknown>;
    if (!PLATFORM_DRIFT_TIERS.includes(r.tier as PlatformDriftEntry["tier"]))
      throw bad(`tier must be one of ${PLATFORM_DRIFT_TIERS.join(", ")}`);
    if (!ALL_MODES.includes(r.mode as Mode)) throw bad(`mode must be one of ${ALL_MODES.join(", ")}`);
    for (const key of ["id", "reason", "seen"] as const) {
      const v = r[key];
      if (typeof v !== "string" || v.trim() === "") throw bad(`${key} must be a non-empty string`);
    }
    const k = `${r.tier as string}/${rowKey(r.mode as Mode, r.id as string)}`;
    if (seen.has(k)) throw bad(`duplicate entry for ${k}`);
    seen.add(k);
  });
}

/** One pre-registered #644 arm: its role in the A/B and the rerank override it runs with. */
export interface RerankLatencyArm {
  role: "baseline" | "candidate" | "combination" | "reference";
  options: RerankOptions;
  /** Combination rows: measured only when every named arm passed the rule. */
  onlyIf?: string[];
}

const RERANK_LATENCY_KEYS = ["$comment", "rule", "arms", "protocol", "qualityBaseline"];
const RERANK_RULE_NUMBERS = ["minLatencyDrop", "maxHit3DropOverallPoints", "maxHit3DropPerCategoryPoints"] as const;
const RERANK_ARM_KEYS = ["$comment", "role", "options", "onlyIf"];
const RERANK_ARM_ROLES: RerankLatencyArm["role"][] = ["baseline", "candidate", "combination", "reference"];
const RERANK_OPTION_KEYS = ["rerankPool", "rerankMaxTokens", "adaptivePool"];

/**
 * Shape-check `thresholds.rerankLatency` (#644) and return its arms by name (empty when the block
 * is absent). A misspelled option key would otherwise run an arm as the baseline, unnoticed.
 */
export function rerankLatencyArms(t: Thresholds): Map<string, RerankLatencyArm> {
  const at = "thresholds.rerankLatency";
  const block = t.rerankLatency;
  if (block === undefined) return new Map();
  const obj = (v: unknown, where: string): Record<string, unknown> => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${where} must be an object`);
    return v as Record<string, unknown>;
  };
  const onlyKeys = (o: Record<string, unknown>, allowed: string[], where: string) => {
    const unknown = Object.keys(o).filter((k) => !allowed.includes(k));
    if (unknown.length)
      throw new Error(`${where} has unknown key ${unknown.join(", ")} (allowed: ${allowed.join(", ")})`);
  };
  const b = obj(block, at);
  onlyKeys(b, RERANK_LATENCY_KEYS, at);
  const rule = obj(b.rule, `${at}.rule`);
  const drop = rule.minLatencyDrop;
  if (typeof drop !== "number" || !(drop > 0 && drop < 1)) {
    throw new Error(`${at}.rule.minLatencyDrop must be a number in (0, 1)`);
  }
  for (const key of RERANK_RULE_NUMBERS) {
    const v = rule[key];
    if (typeof v !== "number" || !(v >= 0)) throw new Error(`${at}.rule.${key} must be a non-negative number`);
  }
  const arms = obj(b.arms, `${at}.arms`);
  const out = new Map<string, RerankLatencyArm>();
  for (const [name, raw] of Object.entries(arms)) {
    const where = `${at}.arms.${name}`;
    const a = obj(raw, where);
    onlyKeys(a, RERANK_ARM_KEYS, where);
    if (!RERANK_ARM_ROLES.includes(a.role as RerankLatencyArm["role"])) {
      throw new Error(`${where}.role must be one of ${RERANK_ARM_ROLES.join(", ")}`);
    }
    const o = obj(a.options, `${where}.options`);
    onlyKeys(o, RERANK_OPTION_KEYS, `${where}.options`);
    for (const key of ["rerankPool", "rerankMaxTokens"] as const) {
      const v = o[key];
      if (v !== undefined && !(Number.isSafeInteger(v) && (v as number) > 0)) {
        throw new Error(`${where}.options.${key} must be a positive integer`);
      }
    }
    if (o.adaptivePool !== undefined && o.adaptivePool !== true) {
      throw new Error(`${where}.options.adaptivePool must be true when set`);
    }
    const onlyIf = a.onlyIf;
    if (onlyIf !== undefined && !(Array.isArray(onlyIf) && onlyIf.every((n) => typeof n === "string"))) {
      throw new Error(`${where}.onlyIf must be an array of arm names`);
    }
    out.set(name, {
      role: a.role as RerankLatencyArm["role"],
      options: o as RerankOptions,
      ...(onlyIf ? { onlyIf: onlyIf as string[] } : {}),
    });
  }
  const baselines = [...out.values()].filter((a) => a.role === "baseline").length;
  if (baselines !== 1) throw new Error(`${at}.arms needs exactly one baseline arm (found ${baselines})`);
  for (const [name, a] of out) {
    const missing = (a.onlyIf ?? []).find((n) => !out.has(n));
    if (missing !== undefined) throw new Error(`${at}.arms.${name}.onlyIf names an undeclared arm "${missing}"`);
  }
  return out;
}
