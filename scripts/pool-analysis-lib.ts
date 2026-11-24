// Pure helpers for two read-only measurements over a deep (topK 50, debug) judged dump: #649's
// rerank admission-miss count and #619's leave-one-out fit of the rerank/cosine blend α. They
// rebuild the production (topK 5) rerank pool from #650 provenance; no production code changes.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blindRecord, gradesFor, type RawHit, type RawRecord } from "./judged-lib.js";
import { gradeFromStore, uncoveredBlind, type StoredJudgment } from "./judged-store.js";

/** Production pair cap (RERANK_POOL): a topK 5 call fuses only this many items before the rerank. */
export const PRODUCTION_FUSED_CUT = 30;

/** The #650 provenance fields these measurements read; absent fields stay undefined. */
export interface Provenance {
  vectorRank?: number;
  keywordRank?: number;
  fusedRank?: number;
  rerankPool: boolean;
}

/** A hit's provenance, narrowed from the dump's untyped record (undefined when the run lacked debug level). */
export function provenanceOf(hit: RawHit): Provenance | undefined {
  const p = hit.provenance;
  if (!p) return undefined;
  const num = (k: string) => (typeof p[k] === "number" ? p[k] : undefined);
  return {
    ...(num("vectorRank") !== undefined ? { vectorRank: num("vectorRank") } : {}),
    ...(num("keywordRank") !== undefined ? { keywordRank: num("keywordRank") } : {}),
    ...(num("fusedRank") !== undefined ? { fusedRank: num("fusedRank") } : {}),
    rerankPool: p.rerankPool === true,
  };
}

/**
 * Split a deep call's hits into the production call's rerank pool and the rest of its fused list.
 * A topK 5 call fuses only the top PRODUCTION_FUSED_CUT items, and its admitted prefix is the deep
 * call's admitted prefix cut at that fused rank (strong-tier items can let a deep call admit
 * further). `rest` keeps the deep output order, which for these items is the production order
 * (unadmitted body hits in fused order, then strong-tier hits).
 */
export function productionPool(
  hits: readonly RawHit[],
  cut = PRODUCTION_FUSED_CUT,
): { pool: RawHit[]; rest: RawHit[] } {
  const pool: RawHit[] = [];
  const rest: RawHit[] = [];
  for (const h of hits) {
    const p = provenanceOf(h);
    if (!p || p.fusedRank === undefined || p.fusedRank > cut) continue;
    (p.rerankPool && h.rerankScore !== undefined ? pool : rest).push(h);
  }
  return { pool, rest };
}

/** How the pool is ordered: the α blend, or rerank with cosine breaking exact / 0.01-bucket ties. */
export type PoolOrder = { kind: "blend"; alpha: number } | { kind: "tieBreak"; bucket: boolean };

/**
 * Order the production pool, then append the rest (#619). Blend: α · rerank + (1 − α) · minmax(cosine)
 * over the pool, a missing cosine taking the pool minimum, a flat pool scoring 0. Ties fall to
 * passage order (`at`), the stand-in for the production chunk-id tie.
 */
export function orderPool(pool: readonly RawHit[], rest: readonly RawHit[], order: PoolOrder): RawHit[] {
  const cos = pool.map((h) => h.cosine).filter((c): c is number => c !== undefined);
  const lo = cos.length ? Math.min(...cos) : 0;
  const hi = cos.length ? Math.max(...cos) : 0;
  const scaled = (h: RawHit) => (hi > lo ? ((h.cosine ?? lo) - lo) / (hi - lo) : 0);
  const rr = (h: RawHit) => h.rerankScore ?? 0;
  const cmp =
    order.kind === "blend"
      ? (a: RawHit, b: RawHit) => {
          const s = (h: RawHit) => order.alpha * rr(h) + (1 - order.alpha) * scaled(h);
          return s(b) - s(a) || a.at - b.at;
        }
      : (a: RawHit, b: RawHit) => {
          const r = (h: RawHit) => (order.bucket ? Math.round(rr(h) * 100) / 100 : rr(h));
          return r(b) - r(a) || (b.cosine ?? lo) - (a.cosine ?? lo) || a.at - b.at;
        };
  return [...[...pool].sort(cmp), ...rest];
}

/** One query's first k hits of a synthetic list, graded from the store: 2 / 1 / 0 / −1, null = unjudged. */
export function gradeList(
  rec: RawRecord,
  hits: readonly RawHit[],
  store: readonly StoredJudgment[],
  k = 5,
): Array<number | null> {
  const run = { ...rec.runs.hybrid!, hits: hits.slice(0, k) };
  const one: RawRecord = { query: rec.query, runs: { hybrid: run } };
  const { key } = blindRecord(one);
  return gradesFor(rec.query.id, "hybrid", key, gradeFromStore([one], store));
}

/** hit@5 and reciprocal rank of one graded list (relevant = grade 2, as judged-lib `metrics`). */
export function hitAndRr(grades: ReadonlyArray<number | null>): { hit5: number; rr: number } {
  const i = grades.slice(0, 5).indexOf(2);
  return { hit5: i >= 0 ? 1 : 0, rr: i >= 0 ? 1 / (i + 1) : 0 };
}

/**
 * The fitted α of one fold: the grid value with the best mean of `score` over the train queries;
 * a tie goes to the median of the tied values (the larger middle one on an even count).
 */
export function fitAlpha(grid: readonly number[], score: (alpha: number) => number): number {
  const scores = grid.map((a) => ({ a, s: score(a) }));
  const best = Math.max(...scores.map((x) => x.s));
  // float sums of 1/rank: compare with a tolerance so equal MRRs tie
  const tied = scores
    .filter((x) => best - x.s < 1e-12)
    .map((x) => x.a)
    .sort((x, y) => x - y);
  return tied[Math.floor(tied.length / 2)]!;
}

/** A half's top-N candidate the production call did not score (#649), with where it sat. */
export interface AdmissionCandidate {
  hit: RawHit;
  half: "vector" | "keyword" | "both";
  vectorRank?: number;
  keywordRank?: number;
  fusedRank?: number;
}

/** A half rank ≤ N the deep call does not show: the item fell past fused rank topK, never scored. */
export interface Unclassified {
  half: "vector" | "keyword";
  rank: number;
}

/**
 * #649's candidates in one deep call: hits in either half's top N outside the production pool,
 * plus the half ranks ≤ N that are known to exist (a higher rank of that half is shown, or the
 * fused list was cut at topK) but are missing from the call. A half with no rank shown is empty.
 */
export function admissionCandidates(
  hits: readonly RawHit[],
  n: number,
  topK: number,
  cut = PRODUCTION_FUSED_CUT,
): { candidates: AdmissionCandidate[]; unclassified: Unclassified[] } {
  const candidates: AdmissionCandidate[] = [];
  const seen = { vector: new Set<number>(), keyword: new Set<number>() };
  for (const hit of hits) {
    const p = provenanceOf(hit);
    if (!p) continue;
    if (p.vectorRank !== undefined) seen.vector.add(p.vectorRank);
    if (p.keywordRank !== undefined) seen.keyword.add(p.keywordRank);
    const inV = p.vectorRank !== undefined && p.vectorRank <= n;
    const inK = p.keywordRank !== undefined && p.keywordRank <= n;
    const scored = p.rerankPool && p.fusedRank !== undefined && p.fusedRank <= cut;
    if ((!inV && !inK) || scored) continue;
    candidates.push({
      hit,
      half: inV && inK ? "both" : inV ? "vector" : "keyword",
      ...(p.vectorRank !== undefined ? { vectorRank: p.vectorRank } : {}),
      ...(p.keywordRank !== undefined ? { keywordRank: p.keywordRank } : {}),
      ...(p.fusedRank !== undefined ? { fusedRank: p.fusedRank } : {}),
    });
  }
  const unclassified: Unclassified[] = [];
  for (const half of ["vector", "keyword"] as const) {
    const ranks = seen[half];
    // a half with no rank shown is empty: its rank 1 (RRF ≥ 1/61) would beat every other single-half item
    if (ranks.size === 0) continue;
    const top = Math.max(...ranks);
    for (let r = 1; r <= n; r++)
      if (!ranks.has(r) && (r < top || hits.length >= topK)) unclassified.push({ half, rank: r });
  }
  return { candidates, unclassified };
}

/**
 * Write a judge run dir for the judged-blind Workflow: queries.json verbatim (the store's query
 * set), one hybrid list per query holding the hits to grade, and blind batches of the hits the
 * store does not cover yet. Returns the item and batch counts the Workflow call needs.
 */
export function writeJudgeDir(
  outDir: string,
  queriesJson: string,
  records: readonly RawRecord[],
  store: readonly StoredJudgment[],
): { items: number; batches: number } {
  const batchSize = 40; // queries per batch file, as judged-dump writes them
  const blindDir = join(outDir, "blind");
  mkdirSync(blindDir, { recursive: true });
  // stale batches first, so the judges never grade an old one
  for (const f of readdirSync(blindDir).filter((n) => /^batch-\d+\.json$/.test(n))) rmSync(join(blindDir, f));
  writeFileSync(join(outDir, "queries.json"), queriesJson);
  writeFileSync(join(outDir, "raw-hits.jsonl"), records.map((r) => `${JSON.stringify(r)}\n`).join(""));
  const { blinds, key } = uncoveredBlind(records, store);
  const batches = Math.ceil(blinds.length / batchSize);
  for (let b = 0; b < batches; b++) {
    const name = `batch-${String(b + 1).padStart(2, "0")}.json`;
    writeFileSync(join(blindDir, name), JSON.stringify(blinds.slice(b * batchSize, (b + 1) * batchSize), null, 1));
  }
  writeFileSync(join(outDir, "blind-key.json"), JSON.stringify(key));
  return { items: blinds.reduce((s, q) => s + q.items.length, 0), batches };
}
