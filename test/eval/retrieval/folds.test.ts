// Unit tests for the fold helper (#632): seeded stratified k-fold / leave-one-out splits,
// cross-validation of a fitted value, and the largest-remainder stratified sample behind the
// held-out draw.

import { describe, expect, it } from "vitest";
import { crossValidate, kFold, leaveOneOut, stratifiedSample, type FoldUnit } from "./folds.js";

/** 23 units over 3 strata of 10, 9 and 4 (the last smaller than k = 5). */
const UNITS: FoldUnit[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `a-${String(i).padStart(2, "0")}`, stratum: "a" })),
  ...Array.from({ length: 9 }, (_, i) => ({ id: `b-${String(i).padStart(2, "0")}`, stratum: "b" })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `c-${String(i).padStart(2, "0")}`, stratum: "c" })),
];
const stratumOf = new Map(UNITS.map((u) => [u.id, u.stratum]));
const shareOf = (fold: string[], stratum: string) => fold.filter((id) => stratumOf.get(id) === stratum).length;

describe("kFold", () => {
  it("same seed and input give identical folds, whatever the input order", () => {
    const a = kFold(UNITS, 5, 7);
    const b = kFold([...UNITS].reverse(), 5, 7);
    expect(b).toEqual(a);
    expect(kFold(UNITS, 5, 8).folds).not.toEqual(a.folds);
  });

  it("puts every unit in exactly one test fold", () => {
    const { folds } = kFold(UNITS, 5);
    expect(folds).toHaveLength(5);
    const all = folds.flat();
    expect(all).toHaveLength(UNITS.length);
    expect(new Set(all).size).toBe(UNITS.length);
    expect([...all].sort()).toEqual(UNITS.map((u) => u.id).sort());
  });

  it("per-stratum fold shares differ by at most one", () => {
    const { folds } = kFold(UNITS, 5);
    for (const s of ["a", "b", "c"]) {
      const shares = folds.map((f) => shareOf(f, s));
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
    expect(folds.map((f) => shareOf(f, "a"))).toEqual([2, 2, 2, 2, 2]);
  });

  it("names a stratum smaller than k, which lands in fewer folds", () => {
    const { folds, sparseStrata } = kFold(UNITS, 5);
    expect(sparseStrata).toEqual([{ stratum: "c", units: 4, folds: 4 }]);
    expect(folds.filter((f) => shareOf(f, "c") > 0)).toHaveLength(4);
  });

  it("defaults to k = 5 and rejects k < 2", () => {
    expect(kFold(UNITS).folds).toHaveLength(5);
    expect(() => kFold(UNITS, 1)).toThrow("k must be an integer ≥ 2");
  });
});

describe("leaveOneOut", () => {
  it("yields n folds of one unit, in id order", () => {
    const { folds, sparseStrata } = leaveOneOut(UNITS.slice(0, 3).reverse());
    expect(folds).toEqual([["a-00"], ["a-01"], ["a-02"]]);
    expect(sparseStrata).toEqual([]);
  });
});

describe("crossValidate", () => {
  it("fits on the other folds, scores on this one, and returns per-fold values with mean / SD", () => {
    const folds = [["x1", "x2"], ["x3"], ["x4", "x5", "x6"]];
    const value: Record<string, number> = { x1: 1, x2: 3, x3: 5, x4: 7, x5: 9, x6: 11 };
    const seenTrain: string[][] = [];
    const res = crossValidate(
      folds,
      (train) => {
        seenTrain.push(train);
        return train.length; // the "fitted value": size of the training set
      },
      (fitted, test) => fitted * 10 + test.reduce((s, id) => s + value[id]!, 0),
    );
    expect(seenTrain).toEqual([
      ["x3", "x4", "x5", "x6"],
      ["x1", "x2", "x4", "x5", "x6"],
      ["x1", "x2", "x3"],
    ]);
    expect(res.perFold).toEqual([
      { fitted: 4, score: 44, n: 2 },
      { fitted: 5, score: 55, n: 1 },
      { fitted: 3, score: 57, n: 3 },
    ]);
    expect(res.mean).toBeCloseTo(52, 10);
    expect(res.sd).toBeCloseTo(Math.sqrt(((44 - 52) ** 2 + (55 - 52) ** 2 + (57 - 52) ** 2) / 2), 10);
  });
});

describe("stratifiedSample", () => {
  it("allocates by largest remainder and is seeded", () => {
    // quotas for 7 of 23: a 3.04, b 2.74, c 1.22 → floors 3/2/1, the one left goes to b (.74)
    const picked = stratifiedSample(UNITS, 7, 7);
    expect(["a", "b", "c"].map((s) => picked.filter((id) => stratumOf.get(id) === s).length)).toEqual([3, 3, 1]);
    expect(stratifiedSample([...UNITS].reverse(), 7, 7)).toEqual(picked);
    expect(new Set(picked).size).toBe(7);
  });

  it("reproduces the #632 held-out allocation over the 66 gated fixture kinds", () => {
    const sizes: Record<string, number> = {
      "semantic-paraphrase": 16,
      "exact-identifier": 12,
      "figure-caption": 7,
      "cross-lingual": 8,
      "ru-monolingual": 8,
      "front-matter-trap": 6,
      negative: 6,
      "figure-negative": 3,
    };
    const units = Object.entries(sizes).flatMap(([k, n]) =>
      Array.from({ length: n }, (_, i) => ({ id: `${k}-${i}`, stratum: k })),
    );
    const picked = stratifiedSample(units, 20);
    const count = (k: string) => picked.filter((id) => id.startsWith(`${k}-`)).length;
    expect(Object.fromEntries(Object.keys(sizes).map((k) => [k, count(k)]))).toEqual({
      "semantic-paraphrase": 5,
      "exact-identifier": 4,
      "figure-caption": 2,
      "cross-lingual": 2,
      "ru-monolingual": 2,
      "front-matter-trap": 2,
      negative: 2,
      "figure-negative": 1,
    });
  });
});
