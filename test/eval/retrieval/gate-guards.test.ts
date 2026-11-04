// Unit tests for the --gate CLI guards (#356 review): flag rejection, up-front baseline loading,
// and the refusal to overwrite a frozen baseline report.

import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Thresholds } from "./gate.js";
import { baselinePaths, checkGateArgs, loadGateBaselines, refuseBaselineOverwrite } from "./gate-guards.js";

const t = {
  baselineReport: "reports/on.json",
  fusionOnly: {
    baselineReport: "reports/2026-11-04-b1c8ce2-rerankoff.json",
    rerank: "off",
    nonRegression: {},
    reportOnlyKinds: [],
  },
} as unknown as Thresholds;

const files: Record<string, string> = {
  "reports/on.json": '{"meta":{"gitSha":"on"}}',
  "reports/2026-11-04-b1c8ce2-rerankoff.json": '{"meta":{"gitSha":"off"}}',
};
const read = (rel: string): string => {
  const body = files[rel];
  if (body === undefined) throw new Error(`ENOENT: ${rel}`);
  return body;
};

describe("checkGateArgs", () => {
  it("rejects --rerank with --gate", () => {
    expect(() => checkGateArgs({ gate: true, live: false, rerank: "off" })).toThrow(
      "--gate runs both rerank ON and OFF passes itself; drop --rerank.",
    );
  });

  it("rejects --live with --gate", () => {
    expect(() => checkGateArgs({ gate: true, live: true })).toThrow("--gate is fixture-only");
  });

  it("allows --rerank without --gate", () => {
    expect(() => checkGateArgs({ gate: false, live: false, rerank: "off" })).not.toThrow();
  });
});

describe("loadGateBaselines", () => {
  it("loads both baselines", () => {
    const b = loadGateBaselines(t, read);
    expect([b.on.meta.gitSha, b.off?.meta.gitSha]).toEqual(["on", "off"]);
  });

  it("fails up front when the fusionOnly baseline file is missing", () => {
    const missing = { ...t, fusionOnly: { ...t.fusionOnly!, baselineReport: "reports/gone.json" } };
    expect(() => loadGateBaselines(missing, read)).toThrow(
      'thresholds.fusionOnly.baselineReport "reports/gone.json" is unreadable: ENOENT: reports/gone.json',
    );
  });

  it("fails up front when fusionOnly has no baselineReport", () => {
    const { baselineReport: _drop, ...rest } = t.fusionOnly!;
    expect(() => loadGateBaselines({ ...t, fusionOnly: rest }, read)).toThrow(
      "thresholds.fusionOnly has no baselineReport — freeze one first (D-012).",
    );
  });

  it("fails on an unparsable ON baseline", () => {
    const bad = (rel: string) => (rel === "reports/on.json" ? "{not json" : read(rel));
    expect(() => loadGateBaselines(t, bad)).toThrow('thresholds.baselineReport "reports/on.json" is unreadable');
  });
});

describe("refuseBaselineOverwrite", () => {
  const dir = "/repo/test/eval/retrieval";
  const guarded = baselinePaths(t, dir);

  it("resolves both baselines against the retrieval dir", () => {
    expect(guarded).toEqual([
      "/repo/test/eval/retrieval/reports/on.json",
      "/repo/test/eval/retrieval/reports/2026-11-04-b1c8ce2-rerankoff.json",
    ]);
  });

  it("refuses the frozen OFF baseline a same-date same-sha gate run would write", () => {
    const target = path.join(dir, "reports", "2026-11-04-b1c8ce2-rerankoff.json");
    expect(() => refuseBaselineOverwrite(target, guarded)).toThrow(
      `refusing to overwrite frozen baseline ${target} — pass --out-dir or --tag to write elsewhere`,
    );
  });

  it("refuses the baseline's .md companion too", () => {
    const target = path.join(dir, "reports", "2026-11-04-b1c8ce2-rerankoff.md");
    expect(() => refuseBaselineOverwrite(target, guarded)).toThrow("refusing to overwrite frozen baseline");
  });

  it("allows any other report path", () => {
    expect(() =>
      refuseBaselineOverwrite(path.join(dir, "reports", "2026-11-05-abc1234-rerankoff.json"), guarded),
    ).not.toThrow();
  });
});
