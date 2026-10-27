// #142 weighted-RRF sweep scorer: reads the reports rrf-sweep.sh wrote and prints mechanical
// PASS/FAIL per weight against thresholds.json `rrfWeightSweep` (gates declared BEFORE the sweep,
// D-012 protocol), plus the selected weight. Pure scoring is exported for the unit test.
//
// Usage: node --import tsx test/eval/retrieval/rrf-sweep.ts [--reports <dir>]

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateGate, type Thresholds } from "./gate.js";
import type { EvalReport, Mode } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HYBRID: Mode = "hybrid";

export type Measurement = "fixtureOn" | "fixtureOff" | "liveOn";
export const MEASUREMENTS: Measurement[] = ["fixtureOn", "fixtureOff", "liveOn"];

/** Shape of thresholds.json `rrfWeightSweep` (extra $comment keys tolerated). */
export interface SweepThresholds {
  candidates: number[];
  baselineWeight: number;
  ruUp: Record<Measurement, { ruInvolvedNdcg10MinDelta: number; crossLingualNdcg10MinDelta: number }>;
  enNonRegression: { kinds: string[] } & Record<
    Measurement,
    { kinds?: string[]; maxNdcg10Drop: number; maxBrokenHit1Queries: number }
  >;
  zeroBroken: { modes: Mode[] };
}

export type WeightReports = Record<Measurement, EvalReport>;

export interface SweepCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface WeightVerdict {
  weight: number;
  checks: SweepCheck[];
  ruPass: boolean;
  enPass: boolean;
  zeroBrokenPass: boolean;
  pass: boolean;
  /** Headline numbers for the results table. */
  numbers: Record<Measurement, { ru: number; xl: number } & Record<string, number | undefined>>;
}

const fmt = (n: number) => n.toFixed(4);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(4)}`;

function ndcg(r: EvalReport, kind?: string): number | undefined {
  return kind ? r.byKind[kind]?.[HYBRID]?.ndcg10 : r.ruInvolved[HYBRID]?.ndcg10;
}

/** Hybrid queries of `kinds` that hit@1 at baseline but not now (a missing row counts as broken). */
function brokenHit1(base: EvalReport, cur: EvalReport, kinds: string[]): string[] {
  const curById = new Map(cur.perQuery.filter((r) => r.mode === HYBRID).map((r) => [r.id, r]));
  return base.perQuery
    .filter((r) => r.mode === HYBRID && kinds.includes(r.kind) && r.metrics?.hit1 === 1)
    .filter((b) => curById.get(b.id)?.metrics?.hit1 !== 1)
    .map((b) => b.id);
}

/**
 * Score one weight against the baseline weight's reports. `zeroBroken` is the existing
 * nonRegression gate result for this weight's fixtureOn report (computed by the caller, which
 * owns the file IO for the frozen gate baseline).
 */
export function scoreWeight(
  weight: number,
  base: WeightReports,
  cur: WeightReports,
  t: SweepThresholds,
  zeroBroken: { pass: boolean; detail: string },
): WeightVerdict {
  const checks: SweepCheck[] = [];
  const numbers = {} as WeightVerdict["numbers"];
  let ruPass = true;
  let enPass = true;

  for (const m of MEASUREMENTS) {
    const b = base[m];
    const c = cur[m];
    const ru = ndcg(c, undefined) ?? 0;
    const xl = ndcg(c, "cross-lingual") ?? 0;
    numbers[m] = { ru, xl };

    // RU-up: deltas vs the same measurement at the baseline weight.
    const g = t.ruUp[m];
    const dRu = ru - (ndcg(b, undefined) ?? 0);
    const dXl = xl - (ndcg(b, "cross-lingual") ?? 0);
    const ruOk = dRu >= g.ruInvolvedNdcg10MinDelta - 1e-9 && dXl >= g.crossLingualNdcg10MinDelta - 1e-9;
    ruPass &&= ruOk;
    checks.push({
      name: `${m} RU-up`,
      pass: ruOk,
      detail: `RU-involved ${fmt(ru)} (${signed(dRu)}, need ≥${signed(g.ruInvolvedNdcg10MinDelta)}), cross-lingual ${fmt(xl)} (${signed(dXl)}, need ≥${signed(g.crossLingualNdcg10MinDelta)})`,
    });

    // EN non-regression on the keyword-favoured kinds present in this measurement.
    const e = t.enNonRegression[m];
    const kinds = (e.kinds ?? t.enNonRegression.kinds).filter((k) => b.byKind[k]?.[HYBRID] !== undefined);
    for (const k of kinds) {
      const now = ndcg(c, k) ?? 0;
      const drop = (ndcg(b, k) ?? 0) - now;
      numbers[m][k] = now;
      const broken = brokenHit1(b, c, [k]);
      const ok = drop <= e.maxNdcg10Drop + 1e-9 && broken.length <= e.maxBrokenHit1Queries;
      enPass &&= ok;
      checks.push({
        name: `${m} EN ${k}`,
        pass: ok,
        detail: `nDCG@10 ${fmt(now)} (drop ${fmt(drop)}, allowed ${e.maxNdcg10Drop}); broken Hit@1 ${broken.length}${broken.length ? ` [${broken.join(", ")}]` : ""} (allowed ${e.maxBrokenHit1Queries})`,
      });
    }
  }

  checks.push({ name: "fixtureOn zero-broken gate (nonRegression)", pass: zeroBroken.pass, detail: zeroBroken.detail });
  return {
    weight,
    checks,
    ruPass,
    enPass,
    zeroBrokenPass: zeroBroken.pass,
    pass: ruPass && enPass && zeroBroken.pass,
    numbers,
  };
}

export type Selection =
  | { kind: "ship"; weight: number }
  | { kind: "stay"; reason: string }
  | { kind: "adaptive-needed"; reason: string };

/** Apply the declared selection rule (thresholds.rrfWeightSweep.selection). */
export function select(verdicts: WeightVerdict[], baselineWeight: number): Selection {
  const candidates = verdicts.filter((v) => v.weight !== baselineWeight);
  const passing = candidates.filter((v) => v.pass);
  if (passing.length > 0) {
    // max liveOn RU nDCG; ties → smaller weight (least departure from plain RRF).
    const best = [...passing].sort((a, b) => b.numbers.liveOn.ru - a.numbers.liveOn.ru || a.weight - b.weight)[0]!;
    return { kind: "ship", weight: best.weight };
  }
  const ruOnly = candidates.filter((v) => v.ruPass && !v.enPass);
  if (ruOnly.length > 0) {
    return {
      kind: "adaptive-needed",
      reason: `RU gates pass only where EN fails (w=${ruOnly.map((v) => v.weight).join(", ")}) — a static weight can't satisfy both`,
    };
  }
  return { kind: "stay", reason: "no candidate weight passes all declared gates" };
}

/** Latest report in `dir` whose filename ends with `suffix` (filenames start with the ISO date). */
function findReport(dir: string, suffix: string): EvalReport {
  const hits = readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort();
  const file = hits.at(-1);
  if (!file) throw new Error(`no report *${suffix} in ${dir} — run rrf-sweep.sh first`);
  return JSON.parse(readFileSync(path.join(dir, file), "utf8")) as EvalReport;
}

function loadWeight(dir: string, w: number): WeightReports {
  // Tag spelling mirrors rrf-sweep.sh (`w1.0`, `w1.25`, …).
  const tag = `rrf142-w${Number.isInteger(w) ? w.toFixed(1) : String(w)}`;
  return {
    fixtureOn: findReport(dir, `-${tag}-on.json`),
    fixtureOff: findReport(dir, `-${tag}-off.json`),
    liveOn: findReport(dir, `-${tag}-on-live.json`),
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--reports");
  const dir = i >= 0 && argv[i + 1] ? argv[i + 1]! : path.join(HERE, "reports");
  const all = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds & {
    rrfWeightSweep: SweepThresholds;
  };
  const t = all.rrfWeightSweep;
  const gateBaseline = JSON.parse(readFileSync(path.join(HERE, all.baselineReport), "utf8")) as EvalReport;
  // The existing gate restricted to the weight-dependent modes.
  const nonRegression = Object.fromEntries(
    t.zeroBroken.modes.map((m) => [m, all.nonRegression[m]]),
  ) as Thresholds["nonRegression"];

  const base = loadWeight(dir, t.baselineWeight);
  const verdicts = t.candidates.map((w) => {
    const cur = loadWeight(dir, w);
    const g = evaluateGate(cur.fixtureOn, gateBaseline, { ...all, nonRegression });
    const failed = g.checks.filter((c) => c.active && !c.pass).map((c) => c.name);
    return scoreWeight(w, base, cur, t, {
      pass: g.pass,
      detail: g.pass ? "PASS" : `FAIL: ${failed.join("; ")}`,
    });
  });

  const out: string[] = [];
  out.push(
    "| VECTOR_RRF_WEIGHT | liveOn RU / xl | liveOn exact-id | fixtureOff RU / xl | fixtureOff exact-id / fmt | fixtureOn RU / xl | fixtureOn exact-id / fmt | zero-broken | RU gate | EN gate |",
  );
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  const n = (x: number | undefined) => (x === undefined ? "—" : x.toFixed(4));
  const pf = (b: boolean) => (b ? "PASS" : "FAIL");
  for (const v of verdicts) {
    const isBase = v.weight === t.baselineWeight;
    // The baseline is the reference, not a candidate — its deltas are 0 by construction.
    const gate = (b: boolean) => (isBase ? "—" : pf(b));
    const L = v.numbers.liveOn;
    const F = v.numbers.fixtureOff;
    const O = v.numbers.fixtureOn;
    out.push(
      `| ${v.weight}${isBase ? " (baseline)" : ""} | ${n(L.ru)} / ${n(L.xl)} | ${n(L["exact-identifier"])} | ${n(F.ru)} / ${n(F.xl)} | ${n(F["exact-identifier"])} / ${n(F["front-matter-trap"])} | ${n(O.ru)} / ${n(O.xl)} | ${n(O["exact-identifier"])} / ${n(O["front-matter-trap"])} | ${pf(v.zeroBrokenPass)} | ${gate(v.ruPass)} | ${gate(v.enPass)} |`,
    );
  }
  out.push("");
  for (const v of verdicts.filter((x) => x.weight !== t.baselineWeight)) {
    out.push(`### w=${v.weight} — ${pf(v.pass)}`);
    for (const c of v.checks) out.push(`- [${pf(c.pass)}] ${c.name} — ${c.detail}`);
    out.push("");
  }
  const s = select(verdicts, t.baselineWeight);
  out.push(
    s.kind === "ship"
      ? `SELECTION: ship VECTOR_RRF_WEIGHT = ${s.weight}`
      : s.kind === "stay"
        ? `SELECTION: ${t.baselineWeight} stays — ${s.reason}`
        : `SELECTION: query-adaptive weighting needed (NOT built, non-goal) — ${s.reason}`,
  );
  // CLI output on stdout (a script, not the stdio MCP server).
  process.stdout.write(out.join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
