// Shared fixture for the #618 equivalence tests: a seeded random library with uneven chunk counts
// and duplicated vectors (ties inside and across books), plus today's ranking algorithm as the
// oracle — full topK sort over every candidate, then the first chunk per book.

import { EMBED_DIM } from "../../src/semantic/model.js";
import { type Candidate, l2normalize, type ScoredHit, topK } from "../../src/semantic/vector.js";
import { mulberry32 } from "../eval/retrieval/stats.js";

/** One book of the seeded library: its id and its chunk vectors in chunk order. */
export interface SeededBook {
  bookId: number;
  vectors: Float32Array[];
}

/** A random unit vector from `rand`. */
export function randomUnit(rand: () => number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) v[i] = rand() * 2 - 1;
  return l2normalize(v);
}

/**
 * `bookCount` books on non-contiguous ids with 1–`maxChunks` chunks each. About one chunk in
 * eight reuses an earlier vector (same book or another), and every seventh book is a full copy
 * of an earlier book, so equal best scores happen within and across books; every fifth book
 * (from the second) ends with a copy of its first vector.
 */
export function seededLibrary(seed: number, bookCount = 56, maxChunks = 24): SeededBook[] {
  const rand = mulberry32(seed);
  const pool: Float32Array[] = [];
  const books: SeededBook[] = [];
  for (let b = 0; b < bookCount; b++) {
    const bookId = 3 + b * 2 + (b % 5 === 0 ? 1 : 0); // gaps and odd steps, never sequential
    if (b > 0 && b % 7 === 0) {
      const src = books[Math.floor(rand() * books.length)]!;
      books.push({ bookId, vectors: src.vectors.map((v) => v.slice()) });
      continue;
    }
    const n = 1 + Math.floor(rand() * maxChunks);
    const vectors: Float32Array[] = [];
    for (let c = 0; c < n; c++) {
      const reuse = pool.length > 0 && rand() < 0.125;
      const v = reuse ? pool[Math.floor(rand() * pool.length)]!.slice() : randomUnit(rand);
      vectors.push(v);
      pool.push(v);
    }
    if (b % 5 === 1) vectors.push(vectors[0]!.slice()); // a sure within-book tie at its first vector
    books.push({ bookId, vectors });
  }
  return books;
}

/**
 * Queries for a seeded library: random directions, exact copies of stored vectors, and the second
 * book's first vector — that book's best score then ties between its first and last chunk.
 */
export function seededQueries(seed: number, books: SeededBook[]): Float32Array[] {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const all = books.flatMap((b) => b.vectors);
  return [
    randomUnit(rand),
    randomUnit(rand),
    randomUnit(rand),
    all[Math.floor(rand() * all.length)]!.slice(),
    all[Math.floor(rand() * all.length)]!.slice(),
    books[1]!.vectors[0]!.slice(),
  ];
}

/** Today's library scope (pre-#618): full sort of every candidate, then the first chunk per book. */
export function oracleLibrary(
  query: Float32Array,
  cands: Candidate[],
  k: number,
  allow?: ReadonlySet<number>,
): ScoredHit[] {
  const pool = allow === undefined ? cands : cands.filter((c) => allow.has(c.bookId));
  const best = new Map<number, ScoredHit>();
  for (const h of topK(query, pool, Number.MAX_SAFE_INTEGER)) {
    if (!best.has(h.bookId)) best.set(h.bookId, h);
    if (best.size >= k) break;
  }
  return [...best.values()];
}

/** Today's book scope (pre-#618): topK over that book's candidates. */
export function oracleBook(query: Float32Array, cands: Candidate[], bookId: number, k: number): ScoredHit[] {
  return topK(
    query,
    cands.filter((c) => c.bookId === bookId),
    k,
  );
}
