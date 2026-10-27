// RERANK_FLOOR recalibration scorer: replays the lowConfidence rule offline over the per-row
// maxRerank/maxScore of one fixture report (+ optional live report) for every candidate floor,
// and prints mechanical PASS/FAIL against thresholds.json `rerankFloor` (declared BEFORE the
// measurement, D-012 protocol). Pure scoring is exported for the unit test.
//
// Usage: node --import tsx test/eval/retrieval/rerank-floor.ts --fixture <report.json> [--live <report.json>]

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateGate, type Thresholds } from "./gate.js";
import type { EvalReport, Mode, PerQueryRow } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Mirrors config.ts's default semanticFloor — the cosine half of confidence().
const SEMANTIC_FLOOR = 0.78;

/** Shape of thresholds.json `rerankFloor` (extra $comment keys tolerated). */
export interface FloorThresholds {
  candidates: number[];
  currentFloor: number;
  population: { fixture: { modes: Mode[] }; live: { modes: Mode[] } };
  negativeSeparation: { kinds: string[]; marginFactor: number };
}

export interface FloorVerdict {
  floor: number;
  /** Max negative maxRerank vs F * marginFactor. */
  separationPass: boolean;
  falseFlagged: number;
  hit1Positives: number;
  falseFlagRate: number;
  live?: { falseFlagRate: number; negativesUnflagged: string[] };
}

export interface FloorResult {
  verdicts: FloorVerdict[];
  selected: number;
  adopted: boolean;
  maxNegative: number;
  minHit1Positive: number;
  cleanSeparation: boolean;
  /** Best candidate by the selection rule, before the adoption preconditions. */
  best?: number;
  /** thresholds.nonRegression on the fixture report — floor-independent (rankings are fixed). */
  zeroBrokenPass: boolean;
}

const isNegative = (kind: string, t: FloorThresholds) => t.negativeSeparation.kinds.includes(kind);

/** Same rule as confidence()/figuresConfidence(): figures carry no cosine floor. */
export function flagged(row: PerQueryRow, floor: number): boolean {
  const cosineLow = row.target !== "figures" && row.maxScore !== undefined && row.maxScore < SEMANTIC_FLOOR;
  return cosineLow || (row.maxRerank !== undefined && row.maxRerank < floor);
}

function population(r: EvalReport, modes: Mode[]): PerQueryRow[] {
  return r.perQuery.filter((row) => modes.includes(row.mode) && row.reranked === true && row.maxRerank !== undefined);
}

function falseFlags(rows: PerQueryRow[], floor: number, t: FloorThresholds) {
  const hits = rows.filter((r) => !isNegative(r.kind, t) && r.metrics?.hit1 === 1);
  const bad = hits.filter((r) => flagged(r, floor));
  return {
    falseFlagged: bad.length,
    hit1Positives: hits.length,
    falseFlagRate: hits.length ? bad.length / hits.length : 0,
  };
}

export function scoreFloors(
  t: FloorThresholds,
  fixture: EvalReport,
  live?: EvalReport,
  zeroBrokenPass = true,
): FloorResult {
  const fx = population(fixture, t.population.fixture.modes);
  const lv = live ? population(live, t.population.live.modes) : undefined;
  const negs = fx.filter((r) => isNegative(r.kind, t)).map((r) => r.maxRerank!);
  const hit1 = fx.filter((r) => !isNegative(r.kind, t) && r.metrics?.hit1 === 1).map((r) => r.maxRerank!);
  const maxNegative = negs.length ? Math.max(...negs) : 0;
  const minHit1Positive = hit1.length ? Math.min(...hit1) : 1;

  const verdicts = t.candidates.map((floor): FloorVerdict => {
    const v: FloorVerdict = {
      floor,
      separationPass: maxNegative <= floor * t.negativeSeparation.marginFactor,
      ...falseFlags(fx, floor, t),
    };
    if (lv) {
      v.live = {
        falseFlagRate: falseFlags(lv, floor, t).falseFlagRate,
        negativesUnflagged: lv
          .filter((r) => isNegative(r.kind, t) && !flagged(r, floor))
          .map((r) => `${r.id}/${r.mode}`),
      };
    }
    return v;
  });

  // Min falseFlagRate among separating candidates; ties → the larger (more conservative) floor.
  const passing = verdicts.filter((v) => v.separationPass);
  const best = passing.reduce<FloorVerdict | undefined>(
    (b, v) =>
      !b || v.falseFlagRate < b.falseFlagRate || (v.falseFlagRate === b.falseFlagRate && v.floor > b.floor) ? v : b,
    undefined,
  );
  const current = verdicts.find((v) => v.floor === t.currentFloor)!;
  const adopted =
    zeroBrokenPass && !!best && best.floor !== t.currentFloor && current.falseFlagRate - best.falseFlagRate >= 0.15;
  return {
    verdicts,
    selected: adopted ? best!.floor : t.currentFloor,
    adopted,
    maxNegative,
    minHit1Positive,
    cleanSeparation: minHit1Positive > maxNegative,
    ...(best ? { best: best.floor } : {}),
    zeroBrokenPass,
  };
}

export function renderFloors(res: FloorResult): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    "| floor | negative separation | fixture false flags | live false-flag rate | live negatives unflagged |",
    "|---|---|---|---|---|",
    ...res.verdicts.map(
      (v) =>
        `| ${v.floor} | ${v.separationPass ? "PASS" : "FAIL"} | ${v.falseFlagged}/${v.hit1Positives} (${pct(v.falseFlagRate)}) | ` +
        `${v.live ? pct(v.live.falseFlagRate) : "—"} | ${v.live ? v.live.negativesUnflagged.join(", ") || "none" : "—"} |`,
    ),
    "",
    `max fixture negative maxRerank: ${res.maxNegative}; min fixture Hit@1-positive maxRerank: ${res.minHit1Positive}; ` +
      `clean separation: ${res.cleanSeparation ? "YES" : "NO"}`,
    `best by selection rule: ${res.best ?? "none"}; zeroBroken (nonRegression gate on the fixture report): ${res.zeroBrokenPass ? "PASS" : "FAIL"}`,
    `selected: ${res.selected} (${res.adopted ? "ADOPT" : "current floor stays"})`,
  ];
  return lines.join("\n");
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const fixturePath = arg("--fixture");
  if (!fixturePath) throw new Error("--fixture <report.json> is required");
  const livePath = arg("--live");
  const all = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds & {
    rerankFloor: FloorThresholds;
  };
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as EvalReport;
  const fixture = read(fixturePath);
  // The floor only toggles lowConfidence, never rankings, so the gate on this report IS the
  // gate at every candidate floor (negativesFlagged aside, which negativeSeparation implies).
  const zeroBroken = evaluateGate(fixture, read(path.join(HERE, all.baselineReport)), all).pass;
  const res = scoreFloors(all.rerankFloor, fixture, livePath ? read(livePath) : undefined, zeroBroken);
  process.stdout.write(renderFloors(res) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
