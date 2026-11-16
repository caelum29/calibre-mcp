// Replay of real Linux nightly reports through the #364 Linux gate rule. The nightly (ubuntu-24.04)
// alternates between two outcomes whose model rankings drift from the macOS baselines; both must
// pass under thresholds.linux and fail under the exact rule. Reports come from the `eval-reports`
// artifacts of runs 43706959540 (outcome A) and 43414339932 (outcome B), committed because
// artifacts expire after 30 days.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateFusionOnlyGate, evaluateGate, evaluateListDiff, type GateResult, type Thresholds } from "./gate.js";
import { gateRuleFor } from "./gate-guards.js";
import type { EvalReport } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = <T>(rel: string): T => JSON.parse(readFileSync(path.join(HERE, rel), "utf8")) as T;
const thresholds = read<Thresholds>("thresholds.json");

// the baselines these nightlies ran against; pinned, so a later re-freeze doesn't rewrite the evidence
const ON_BASE = read<EvalReport>("reports/2026-10-24-f8bb617-v4-t431-fixture.json");
const OFF_BASE = read<EvalReport>("reports/2026-11-05-eec059d-tiebreak-rerankoff.json");

const OUTCOMES = [
  {
    name: "A (2026-11-15, 7 of 10 runs)",
    on: "reports/2026-11-15-cebaace-linux-nightly.json",
    off: "reports/2026-11-15-cebaace-linux-nightly-rerankoff.json",
    skippedOn: "2 broken: id-09, xl-05",
    skippedOff: "0 broken",
  },
  {
    name: "B (2026-11-13, 3 of 10 runs)",
    on: "reports/2026-11-13-f7f5306-linux-nightly.json",
    off: "reports/2026-11-13-f7f5306-linux-nightly-rerankoff.json",
    skippedOn: "1 broken: id-09",
    skippedOff: "1 broken: id-05",
  },
];

/** Both passes of `--gate` (non-regression, score drift, platform-drift, list diff) under one rule. */
function replay(platform: string, onRel: string, offRel: string): { on: GateResult; off: GateResult } {
  const rule = gateRuleFor(platform, thresholds);
  const on = read<EvalReport>(onRel);
  const off = read<EvalReport>(offRel);
  const list = (cur: EvalReport, base: EvalReport, tier: "on" | "fusionOnly") =>
    evaluateListDiff(cur, base, { tier, topK: 10, allow: [], blocking: rule.listDiffBlocking });
  const merge = (a: GateResult, b: GateResult): GateResult => ({
    pass: a.pass && b.pass,
    checks: [...a.checks, ...b.checks],
    drops: [...a.drops, ...b.drops],
  });
  return {
    on: merge(evaluateGate(on, ON_BASE, thresholds, rule.platformDrift), list(on, ON_BASE, "on")),
    off: merge(
      evaluateFusionOnlyGate(off, OFF_BASE, thresholds.fusionOnly!, rule.platformDrift),
      list(off, OFF_BASE, "fusionOnly"),
    ),
  };
}

const detail = (r: GateResult, name: string) => r.checks.find((c) => c.name === name)?.detail;
const failing = (r: GateResult) => r.checks.filter((c) => c.active && !c.pass).map((c) => c.name);

describe.each(OUTCOMES)("Linux nightly outcome $name", ({ on, off, skippedOn, skippedOff }) => {
  it("passes both passes under the Linux rule, printing the skips", () => {
    const res = replay("linux", on, off);
    expect(failing(res.on)).toEqual([]);
    expect(failing(res.off)).toEqual([]);
    expect(detail(res.on, "non-regression hybrid: platform drift (skipped)")).toBe(skippedOn);
    expect(detail(res.on, "non-regression vector: platform drift (skipped)")).toBe(skippedOn);
    expect(detail(res.off, "fusion-only hybrid: platform drift (skipped)")).toBe(skippedOff);
    expect(detail(res.on, "top-10 list diff (on, report-only)")).toMatch(/^108 changed, 0 allowed \(of 204 rows\)/);
  });

  it("fails under the exact (macOS) rule, so the replay is not vacuous", () => {
    const res = replay("darwin", on, off);
    expect(failing(res.on)).toEqual([
      "non-regression hybrid: broken Hit@1 queries",
      "non-regression vector: broken Hit@1 queries",
      "top-10 list diff (on)",
    ]);
    expect(failing(res.off)).toContain("top-10 list diff (fusionOnly)");
  });
});

describe("thresholds.linux against the current baselines", () => {
  it("no platform-drift entry is stale (re-check after every on/fusionOnly re-freeze)", () => {
    const rule = gateRuleFor("linux", thresholds);
    expect(rule.name).toBe("linux");
    const on = read<EvalReport>(thresholds.baselineReport);
    const off = read<EvalReport>(thresholds.fusionOnly!.baselineReport!);
    expect(detail(evaluateGate(on, on, thresholds, rule.platformDrift), "platform-drift entries (on)")).toMatch(
      /all solved by the baseline$/,
    );
    expect(
      detail(
        evaluateFusionOnlyGate(off, off, thresholds.fusionOnly!, rule.platformDrift),
        "platform-drift entries (fusionOnly)",
      ),
    ).toMatch(/all solved by the baseline$/);
  });
});
