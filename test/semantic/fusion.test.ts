import { describe, expect, it } from "vitest";
import { rrfFuse } from "../../src/semantic/fusion.js";

describe("rrfFuse", () => {
  it("rewards items ranked well in BOTH lists over a top-of-one-list item", () => {
    // id 1 is #1 then #2; id 3 is #3 then #1. Summed reciprocal ranks put 1 ahead of 3 ahead of 2.
    const fused = rrfFuse([
      [1, 2, 3],
      [3, 1, 2],
    ]);
    expect(fused.map((f) => f.id)).toEqual([1, 3, 2]);
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
  });

  it("unions ids that appear in only one list", () => {
    const fused = rrfFuse([
      [1, 2],
      [3, 4],
    ]);
    expect(fused.map((f) => f.id).sort()).toEqual([1, 2, 3, 4]);
  });

  it("preserves single-list order", () => {
    expect(rrfFuse([[5, 6, 7]]).map((f) => f.id)).toEqual([5, 6, 7]);
  });

  it("returns [] for no rankings", () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([[], []])).toEqual([]);
  });

  it("uses 1-based ranks with k so the top item scores 1/(k+1)", () => {
    expect(rrfFuse([[9]], 60)[0]!.score).toBeCloseTo(1 / 61, 10);
  });
});
