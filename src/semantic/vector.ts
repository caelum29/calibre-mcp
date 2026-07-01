// Pure vector primitives for the semantic index. No I/O, no deps — trivially testable.
// Vectors are stored as raw Float32 little-endian BLOBs and L2-normalized at write time,
// so cosine similarity collapses to a plain dot product at query time.

import { EMBED_DIM } from "./model.js";

/** Serialize a 384-dim vector to a 1536-byte little-endian Float32 BLOB. */
export function encodeVector(v: Float32Array): Buffer {
  if (v.length !== EMBED_DIM) {
    throw new Error(`expected ${EMBED_DIM}-dim vector, got ${v.length}`);
  }
  // Copy into a fresh, densely-packed buffer (v may be a view with an offset/stride).
  const buf = Buffer.allocUnsafe(EMBED_DIM * 4);
  for (let i = 0; i < EMBED_DIM; i++) buf.writeFloatLE(v[i]!, i * 4);
  return buf;
}

/**
 * Decode a stored BLOB back to a Float32Array. node:sqlite hands BLOBs back as a
 * Uint8Array that may be a VIEW into a larger pooled buffer, so honor byteOffset and
 * copy — building a Float32Array straight over a mis-aligned/oversized buffer is a bug.
 */
export function decodeVector(u8: Uint8Array): Float32Array {
  if (u8.byteLength !== EMBED_DIM * 4) {
    throw new Error(`expected ${EMBED_DIM * 4}-byte vector blob, got ${u8.byteLength}`);
  }
  const out = new Float32Array(EMBED_DIM);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let i = 0; i < EMBED_DIM; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/** L2-normalize in place and return the same array (zero vectors pass through unchanged). */
export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i]! /= norm;
  return v;
}

/** Dot product == cosine similarity for pre-normalized vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** A candidate vector plus the ids needed to resolve it back to a chunk/book. */
export interface Candidate {
  chunkId: number;
  bookId: number;
  vector: Float32Array;
}

/** A scored hit after brute-force cosine ranking. */
export interface ScoredHit {
  chunkId: number;
  bookId: number;
  score: number;
}

/** Brute-force top-k by cosine (dot). Ties keep insertion order; k clamps to length. */
export function topK(query: Float32Array, candidates: Candidate[], k: number): ScoredHit[] {
  const scored = candidates.map((c) => ({
    chunkId: c.chunkId,
    bookId: c.bookId,
    score: dot(query, c.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, k));
}
