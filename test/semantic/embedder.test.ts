// Pure vector-shaping contract of the embedder (no model download): dim validation and
// the MRL truncate-then-renormalize recipe the candidate table (model.ts) relies on.

import { describe, expect, it } from "vitest";
import { toStoredVector } from "../../src/semantic/embedder.js";
import { dot } from "../../src/semantic/vector.js";

describe("toStoredVector", () => {
  it("passes a full-width row through as a unit vector", () => {
    const v = toStoredVector([3, 4], { dim: 2 });

    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
  });

  it("throws when the row width does not match the spec", () => {
    expect(() => toStoredVector([1, 2, 3], { dim: 2 })).toThrow(/dim 3 != expected 2/);
  });

  it("MRL-truncates to dim and re-normalizes (model-card recipe)", () => {
    // Raw 4-dim row, already unit-norm; keep the first 2 dims → must be re-normalized.
    const raw = [0.5, 0.5, 0.5, 0.5];

    const v = toStoredVector(raw, { dim: 2, rawDim: 4 });

    expect(v.length).toBe(2);
    expect(dot(v, v)).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("validates MRL rows against the RAW width, not the stored one", () => {
    expect(() => toStoredVector([1, 2], { dim: 2, rawDim: 4 })).toThrow(/dim 2 != expected 4/);
  });
});
