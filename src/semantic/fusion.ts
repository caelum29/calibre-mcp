// Reciprocal Rank Fusion (Cormack SIGIR'09) — merges the vector and keyword result lists by
// RANK ONLY, never by raw score. This sidesteps the incommensurable scales of the two halves
// (cosine ∈ [-1,1] vs FTS5 bm25 which is NEGATIVE, best = most negative) by construction: each
// list contributes wᵢ/(k + rank) to an item's fused score, so a good rank in either list helps.
// The optional per-list weights are the weighted-RRF upgrade from the fusion literature (Bruch
// et al., TOIS 2023): per-source weight is the impactful knob, more than k. All-1 = plain RRF.

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
 *
 * `weights[i]` scales list i's contribution (missing/extra entries default to 1, so existing
 * callers are unchanged); weight 0 behaves exactly as if the list were absent.
 */
export function rrfFuse(rankings: number[][], k: number = RRF_K, weights?: number[]): FusedItem[] {
  const scores = new Map<number, number>();
  for (let i = 0; i < rankings.length; i++) {
    const w = weights?.[i] ?? 1;
    if (w === 0) continue; // a zero-weight list contributes nothing — not even to the id union
    const list = rankings[i]!;
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]!;
      scores.set(id, (scores.get(id) ?? 0) + w / (k + rank + 1));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
