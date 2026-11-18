// Unit tests for the #649 / #619 deep-dump helpers: rebuilding the production rerank pool from
// #650 provenance, the α blend order, admission candidates and the leave-one-out tie rule.
import { describe, expect, it } from "vitest";
import type { RawHit } from "../../../scripts/judged-lib.js";
import {
  admissionCandidates,
  fitAlpha,
  hitAndRr,
  orderPool,
  productionPool,
} from "../../../scripts/pool-analysis-lib.js";

/** A deep-dump hit at passage offset `at` with the given scores and provenance. */
function hit(at: number, p: Record<string, unknown>, scores: { cosine?: number; rerankScore?: number } = {}): RawHit {
  return { bookId: 1, title: "t", at, charEnd: at + 10, text: `x${at}`, ...scores, provenance: p };
}

describe("productionPool", () => {
  it("keeps scored hits up to fused rank 30 as the pool and the other fused-top-30 hits as the rest", () => {
    const hits = [
      hit(1, { fusedRank: 2, rerankPool: true }, { rerankScore: 0.9 }),
      hit(2, { fusedRank: 31, rerankPool: true }, { rerankScore: 0.8 }), // only a topK 50 call scores it
      hit(3, { fusedRank: 1, rerankPool: true }, { rerankScore: 0.1 }),
      hit(4, { fusedRank: 29, rerankPool: false }),
      hit(5, { fusedRank: 40, rerankPool: false }),
    ];
    const { pool, rest } = productionPool(hits);
    expect(pool.map((h) => h.at)).toEqual([1, 3]);
    expect(rest.map((h) => h.at)).toEqual([4]);
  });
});

describe("orderPool", () => {
  const pool = [
    hit(10, {}, { rerankScore: 0.9, cosine: 0.8 }),
    hit(20, {}, { rerankScore: 0.03, cosine: 0.86 }),
    hit(30, {}, { rerankScore: 0.5 }), // keyword-only: takes the pool's minimum cosine
  ];
  const rest = [hit(40, {})];

  it("α = 1 is the rerank order, the rest appended", () => {
    expect(orderPool(pool, rest, { kind: "blend", alpha: 1 }).map((h) => h.at)).toEqual([10, 30, 20, 40]);
  });

  it("α = 0 is the min-max cosine order; the missing cosine scores 0 and ties fall to passage order", () => {
    // minmax over [0.8, 0.86]: 10 → 0, 20 → 1, 30 → 0 (min) — 10 and 30 tie, 10 first
    expect(orderPool(pool, rest, { kind: "blend", alpha: 0 }).map((h) => h.at)).toEqual([20, 10, 30, 40]);
  });

  it("α = 0.5 mixes both: 0.45 + 0, 0.015 + 0.5, 0.25 + 0", () => {
    expect(orderPool(pool, [], { kind: "blend", alpha: 0.5 }).map((h) => h.at)).toEqual([20, 10, 30]);
  });

  it("a flat-cosine pool contributes 0 to every blend score", () => {
    const flat = [hit(1, {}, { rerankScore: 0.2, cosine: 0.7 }), hit(2, {}, { rerankScore: 0.6, cosine: 0.7 })];
    expect(orderPool(flat, [], { kind: "blend", alpha: 0.1 }).map((h) => h.at)).toEqual([2, 1]);
  });

  it("the tie-break rows let cosine decide only equal (or equal-bucket) rerank scores", () => {
    const tied = [
      hit(1, {}, { rerankScore: 0.501, cosine: 0.7 }),
      hit(2, {}, { rerankScore: 0.504, cosine: 0.9 }),
      hit(3, {}, { rerankScore: 0.2, cosine: 0.99 }),
    ];
    expect(orderPool(tied, [], { kind: "tieBreak", bucket: false }).map((h) => h.at)).toEqual([2, 1, 3]);
    expect(orderPool(tied, [], { kind: "tieBreak", bucket: true }).map((h) => h.at)).toEqual([2, 1, 3]);
    const bucketFlip = [
      hit(1, {}, { rerankScore: 0.504, cosine: 0.7 }),
      hit(2, {}, { rerankScore: 0.501, cosine: 0.9 }),
    ];
    expect(orderPool(bucketFlip, [], { kind: "tieBreak", bucket: false }).map((h) => h.at)).toEqual([1, 2]);
    expect(orderPool(bucketFlip, [], { kind: "tieBreak", bucket: true }).map((h) => h.at)).toEqual([2, 1]);
  });
});

describe("admissionCandidates", () => {
  it("lists half top-N hits outside the production pool and the half ranks the call cannot show", () => {
    const hits = [
      hit(1, { vectorRank: 1, keywordRank: 1, fusedRank: 1, rerankPool: true }, { rerankScore: 0.9 }),
      hit(2, { keywordRank: 2, fusedRank: 35, rerankPool: false }), // keyword top 5, never scored
      hit(3, { vectorRank: 3, fusedRank: 33, rerankPool: true }, { rerankScore: 0.4 }), // scored only past rank 30
      hit(4, { vectorRank: 9, fusedRank: 40, rerankPool: false }), // outside N
      hit(5, { keywordRank: 7, fusedRank: 45, rerankPool: false }),
    ];
    const { candidates, unclassified } = admissionCandidates(hits, 5, 50);
    expect(candidates.map((c) => [c.hit.at, c.half])).toEqual([
      [2, "keyword"],
      [3, "vector"],
    ]);
    // vector ranks 2, 4, 5 and keyword 3, 4, 5 exist (a higher rank of the half is shown) but are absent
    expect(unclassified).toEqual([
      { half: "vector", rank: 2 },
      { half: "vector", rank: 4 },
      { half: "vector", rank: 5 },
      { half: "keyword", rank: 3 },
      { half: "keyword", rank: 4 },
      { half: "keyword", rank: 5 },
    ]);
  });

  it("a full fused list with no keyword rank at all means an empty keyword half, not unclassified ranks", () => {
    const hits = Array.from({ length: 50 }, (_, i) =>
      hit(i, { vectorRank: i + 1, fusedRank: i + 1, rerankPool: i < 30 }, i < 30 ? { rerankScore: 0.5 } : {}),
    );
    expect(admissionCandidates(hits, 5, 50)).toEqual({ candidates: [], unclassified: [] });
  });

  it("a short fused list shows every candidate: missing ranks past a half's last one do not exist", () => {
    const hits = [hit(1, { vectorRank: 1, keywordRank: 1, fusedRank: 1, rerankPool: true }, { rerankScore: 0.9 })];
    expect(admissionCandidates(hits, 5, 50)).toEqual({ candidates: [], unclassified: [] });
  });
});

describe("fitAlpha and hitAndRr", () => {
  it("takes the best score and, on a tie, the median tied value (the larger middle one on even counts)", () => {
    const grid = [0, 0.25, 0.5, 0.75, 1];
    expect(fitAlpha(grid, (a) => (a === 0.5 ? 1 : 0))).toBe(0.5);
    expect(fitAlpha(grid, (a) => (a >= 0.25 ? 1 : 0))).toBe(0.75);
    expect(fitAlpha(grid, (a) => (a <= 0.5 ? 1 : 0))).toBe(0.25);
  });

  it("counts only grade 2 in the top 5", () => {
    expect(hitAndRr([1, null, 2, 0, 0])).toEqual({ hit5: 1, rr: 1 / 3 });
    expect(hitAndRr([1, 1, 0, 0, 0, 2])).toEqual({ hit5: 0, rr: 0 });
  });
});
