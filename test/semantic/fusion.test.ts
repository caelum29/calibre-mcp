import { describe, expect, it } from "vitest";
import { RRF_K, rrfFuse } from "../../src/semantic/fusion.js";

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

  describe("per-list weights", () => {
    const lists = [
      [1, 2, 3],
      [3, 1, 2],
    ];

    it("all-1 weights reproduce unweighted RRF exactly", () => {
      expect(rrfFuse(lists, RRF_K, [1, 1])).toEqual(rrfFuse(lists));
    });

    it("weight 0 behaves exactly as if the list were absent", () => {
      expect(rrfFuse([[1, 2], [3, 4]], RRF_K, [1, 0])).toEqual(rrfFuse([[1, 2]]));
    });

    it("a heavier list overrules the lighter one on rank-1 disagreement", () => {
      // Unweighted, [1] vs [2] ties with first-seen order (1 first); weighting list 2 flips it.
      const fused = rrfFuse([[1], [2]], RRF_K, [1, 2]);
      expect(fused.map((f) => f.id)).toEqual([2, 1]);
    });

    it("scales each list's contribution by its weight", () => {
      const fused = rrfFuse([[9]], 60, [2]);
      expect(fused[0]!.score).toBeCloseTo(2 / 61, 10);
    });

    it("missing weight entries default to 1 (existing callers unchanged)", () => {
      expect(rrfFuse(lists, RRF_K, [1])).toEqual(rrfFuse(lists));
    });
  });
});
