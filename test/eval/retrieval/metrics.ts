// Self-written IR metrics for the golden-query retrieval eval (no eval-framework dep).
// All metrics consume one shape: per retrieved position, the labeled relevant items it
// matched (binary relevance) plus the total number of labeled items for the query.

/** Relevance of one ranked result list against a query's labels. */
export interface RankedRelevance {
  /**
   * For each retrieved position (best-first), the keys of labeled relevant items that
   * position matched (empty array = irrelevant result). One position may match several
   * labels (e.g. a chunk overlapping two labeled spans); one label may be matched by
   * several positions (duplicates don't double-count in recall).
   */
  matches: string[][];
  /** Total number of labeled relevant items for the query (>= 1 for scored queries). */
  relevantCount: number;
}

/** Per-query metric row: the four headline numbers of the harness. */
export interface QueryMetrics {
  hit1: number;
  recall5: number;
  /** Reciprocal rank of the first relevant result (0 when none retrieved). */
  rr: number;
  ndcg10: number;
}

/** Mean of each metric over n queries (mrr = mean reciprocal rank). */
export interface AggregateMetrics {
  n: number;
  hit1: number;
  recall5: number;
  mrr: number;
  ndcg10: number;
}

/** 1 when the top-ranked result is relevant, else 0. */
export function hitAt1(r: RankedRelevance): number {
  return (r.matches[0]?.length ?? 0) > 0 ? 1 : 0;
}

/** Fraction of labeled items found anywhere in the top k (distinct labels, no double count). */
export function recallAtK(r: RankedRelevance, k: number): number {
  if (r.relevantCount <= 0) return 0;
  const found = new Set<string>();
  for (const keys of r.matches.slice(0, k)) for (const key of keys) found.add(key);
  return Math.min(1, found.size / r.relevantCount);
}

/** 1/rank of the first relevant result; 0 when nothing relevant was retrieved. */
export function reciprocalRank(r: RankedRelevance): number {
  const idx = r.matches.findIndex((keys) => keys.length > 0);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

/**
 * Binary-gain nDCG@k: DCG sums 1/log2(pos+1) over relevant positions in the top k; the
 * ideal DCG assumes all min(relevantCount, k) labels ranked first. 0 when nothing labeled.
 * A label earns gain only at its FIRST matching rank (same dedupe rule as recallAtK) — at
 * most relevantCount positions can score, which keeps nDCG in [0, 1]. (Fixed 2026-07-09:
 * duplicate-label positions used to add gain, letting nDCG exceed 1; reports before the fix
 * carry the old quirk — see reports/README.md.)
 */
export function ndcgAtK(r: RankedRelevance, k: number): number {
  if (r.relevantCount <= 0) return 0;
  const credited = new Set<string>();
  let dcg = 0;
  for (let i = 0; i < Math.min(k, r.matches.length); i++) {
    const fresh = r.matches[i]!.filter((key) => !credited.has(key));
    if (fresh.length > 0) dcg += 1 / Math.log2(i + 2);
    for (const key of fresh) credited.add(key);
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(r.relevantCount, k); i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** The four per-query numbers the report tabulates. */
export function queryMetrics(r: RankedRelevance): QueryMetrics {
  return {
    hit1: hitAt1(r),
    recall5: recallAtK(r, 5),
    rr: reciprocalRank(r),
    ndcg10: ndcgAtK(r, 10),
  };
}

/** Mean the per-query metrics (empty input → zeros with n=0). */
export function aggregate(rows: QueryMetrics[]): AggregateMetrics {
  const n = rows.length;
  const mean = (f: (m: QueryMetrics) => number) =>
    n === 0 ? 0 : round4(rows.reduce((s, m) => s + f(m), 0) / n);
  return {
    n,
    hit1: mean((m) => m.hit1),
    recall5: mean((m) => m.recall5),
    mrr: mean((m) => m.rr),
    ndcg10: mean((m) => m.ndcg10),
  };
}

/** Stable 4-decimal rounding so committed reports diff cleanly. */
export function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
