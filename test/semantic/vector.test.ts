import { describe, expect, it } from "vitest";
import { EMBED_DIM } from "../../src/semantic/model.js";
import {
  type Candidate,
  decodeVector,
  dot,
  encodeVector,
  l2normalize,
  topK,
} from "../../src/semantic/vector.js";

/** A 384-dim vector filled by a generator (for round-trip fidelity checks). */
function vec(fn: (i: number) => number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) v[i] = fn(i);
  return v;
}

describe("encodeVector / decodeVector", () => {
  it("round-trips a vector exactly (Float32 precision)", () => {
    const v = vec((i) => Math.sin(i) * 0.5);
    const back = decodeVector(encodeVector(v));
    // Float32 storage → compare against the Float32-rounded source, not the f64 sines.
    for (let i = 0; i < EMBED_DIM; i++) expect(back[i]).toBe(v[i]);
  });

  it("produces a 1536-byte blob", () => {
    expect(encodeVector(vec(() => 0.1)).byteLength).toBe(EMBED_DIM * 4);
  });

  it("decodes correctly from a view with a non-zero byteOffset", () => {
    const blob = encodeVector(vec((i) => i * 0.001));
    // Simulate node:sqlite handing back a view into a larger pooled buffer.
    const padded = Buffer.concat([Buffer.from([1, 2, 3]), blob]);
    const view = new Uint8Array(padded.buffer, padded.byteOffset + 3, blob.byteLength);
    expect(view.byteOffset).not.toBe(0);
    const back = decodeVector(view);
    const direct = decodeVector(blob);
    for (let i = 0; i < EMBED_DIM; i++) expect(back[i]).toBe(direct[i]);
  });

  it("rejects a wrong-length vector on encode", () => {
    expect(() => encodeVector(new Float32Array(10))).toThrow();
  });

  it("rejects a wrong-size blob on decode", () => {
    expect(() => decodeVector(new Uint8Array(100))).toThrow();
  });
});

describe("l2normalize", () => {
  it("scales to unit norm", () => {
    const v = l2normalize(vec((i) => (i < 3 ? i + 1 : 0))); // [1,2,3,0,...]
    let sum = 0;
    for (const x of v) sum += x * x;
    expect(Math.sqrt(sum)).toBeCloseTo(1, 6);
  });

  it("leaves a zero vector untouched (no NaN)", () => {
    const v = l2normalize(new Float32Array(EMBED_DIM));
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

describe("dot / topK", () => {
  it("dot equals cosine for normalized vectors", () => {
    const a = l2normalize(vec((i) => (i === 0 ? 1 : 0)));
    const b = l2normalize(vec((i) => (i === 0 ? 1 : 0)));
    expect(dot(a, b)).toBeCloseTo(1, 6);
  });

  it("ranks candidates by descending similarity and clamps k", () => {
    const query = l2normalize(vec((i) => (i === 0 ? 1 : 0)));
    const cands: Candidate[] = [
      { chunkId: 1, bookId: 10, vector: l2normalize(vec((i) => (i === 1 ? 1 : 0))) }, // orthogonal
      { chunkId: 2, bookId: 20, vector: l2normalize(vec((i) => (i === 0 ? 1 : 0))) }, // identical
      { chunkId: 3, bookId: 30, vector: l2normalize(vec((i) => (i === 0 ? 1 : 0.5))) }, // close
    ];
    const hits = topK(query, cands, 2);
    expect(hits.map((h) => h.chunkId)).toEqual([2, 3]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });
});
