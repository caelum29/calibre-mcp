// Reciprocal Rank Fusion (Cormack SIGIR'09) — merges the vector and keyword result lists by
// RANK ONLY, never by raw score. This sidesteps the incommensurable scales of the two halves
// (cosine ∈ [-1,1] vs FTS5 bm25 which is NEGATIVE, best = most negative) by construction: each
// list contributes 1/(k + rank) to an item's fused score, so a good rank in either list helps.

/** RRF constant. 60 is the canonical value from the original paper; dampens top-rank dominance. */
export const RRF_K = 60;

/** One fused result: the shared id (bookId for library scope, chunkId for book scope) + score. */
export interface FusedItem {
  id: number;
  score: number;
}

/**
 * Fuse ranked id lists via RRF. Each input is an array of ids ordered best-first; ranks are
 * 1-based. An id present in several lists accumulates their contributions. Returns all fused
 * ids sorted by descending RRF score (ties keep first-seen order).
 */
export function rrfFuse(rankings: number[][], k: number = RRF_K): FusedItem[] {
  const scores = new Map<number, number>();
  for (const list of rankings) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]!;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
