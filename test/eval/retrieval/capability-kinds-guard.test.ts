// thresholds.capabilityKinds is shape-checked (#359 review): a regression kind listed there would
// silently stop being gated in every tier, and a typo would be a silent no-op. Only the four
// capability kinds, no unknown key, no duplicate; checked wherever the gate reads the block.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { capabilityKindsOf, evaluateFusionOnlyGate, evaluateGate, type Thresholds } from "./gate.js";
import type { EvalReport, QueryKind } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const shipped = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;
const withBlock = (block: unknown) =>
  ({ baselineReport: "x", nonRegression: {}, capabilityKinds: block }) as unknown as Thresholds;
const ALLOWED = "allowed: confuser-pair, no-overlap-paraphrase, adjacent-negative, raw-title";
const empty = { meta: { modes: [], rerank: "off", rerankedRows: 0 }, perQuery: [] } as unknown as EvalReport;

describe("capabilityKindsOf", () => {
  it("accepts the shipped thresholds.json block: the four kinds", () => {
    expect(capabilityKindsOf(shipped)).toEqual([
      "confuser-pair",
      "no-overlap-paraphrase",
      "adjacent-negative",
      "raw-title",
    ]);
  });

  it("returns [] when the block is absent (the exact rule for every kind)", () => {
    expect(capabilityKindsOf({ baselineReport: "x", nonRegression: {} })).toEqual([]);
  });

  it("rejects a regression kind", () => {
    expect(() => capabilityKindsOf(withBlock({ kinds: ["raw-title", "semantic-paraphrase"] }))).toThrow(
      `thresholds.capabilityKinds.kinds: "semantic-paraphrase" is not a capability kind (${ALLOWED})`,
    );
  });

  it("rejects a typo", () => {
    expect(() => capabilityKindsOf(withBlock({ kinds: ["confuser-pairs"] }))).toThrow(
      `thresholds.capabilityKinds.kinds: "confuser-pairs" is not a capability kind (${ALLOWED})`,
    );
  });

  it("rejects a duplicate", () => {
    expect(() => capabilityKindsOf(withBlock({ kinds: ["raw-title", "raw-title"] }))).toThrow(
      'thresholds.capabilityKinds.kinds: duplicate "raw-title"',
    );
  });

  it("rejects an unknown key and a missing kinds array", () => {
    expect(() => capabilityKindsOf(withBlock({ kind: ["raw-title"] }))).toThrow(
      "thresholds.capabilityKinds has unknown key kind (allowed: $comment, kinds, headroom)",
    );
    expect(() => capabilityKindsOf(withBlock({ headroom: {} }))).toThrow(
      "thresholds.capabilityKinds.kinds must be an array",
    );
  });

  it("the rerank-on gate and the fusion-only gate both refuse a bad list", () => {
    expect(() => evaluateGate(empty, empty, withBlock({ kinds: ["semantic-paraphrase"] }))).toThrow(
      '"semantic-paraphrase" is not a capability kind',
    );
    const fusion: NonNullable<Thresholds["fusionOnly"]> = { rerank: "off", nonRegression: {}, reportOnlyKinds: [] };
    expect(() => evaluateFusionOnlyGate(empty, empty, fusion, [], ["semantic-paraphrase" as QueryKind])).toThrow(
      '"semantic-paraphrase" is not a capability kind',
    );
  });
});
