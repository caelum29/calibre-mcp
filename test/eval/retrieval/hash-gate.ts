// Tier-0 model-free eval gate (#357): the golden set through the real pipeline with the hash
// embedder, frozen as per-query RANKS (hash-baseline.json) so `pnpm test` catches drift in
// chunking/FTS/fusion/front-matter in seconds, identically on macOS and Linux CI.

import { hashEmbedder } from "./hash-embedder.js";
import {
  ALL_MODES,
  runRetrievalEval,
  type EvalReport,
  type HarnessOptions,
  type Mode,
  type PerQueryRow,
  type QueryKind,
} from "./harness.js";

/** One frozen row: where the first relevant hit landed, plus the top-10 keys for diagnostics. */
export interface RankRow {
  id: string;
  kind: QueryKind;
  mode: Mode;
  /** 1-based rank of the first relevant result; null = none in the top 10; absent = negative kind. */
  rank?: number | null;
  retrieved: string[];
}

/** hash-baseline.json: ranks only — float scores differ in the last ulp across platforms. */
export interface RankBaseline {
  $comment: string;
  embedder: string;
  gitSha: string;
  queryCount: number;
  modes: Mode[];
  perQuery: RankRow[];
}

/** Run the full golden set with the hash embedder, reranker off, in every mode. */
export function runHashEval(
  opts: { gitSha?: string; patchDeps?: HarnessOptions["patchDeps"] } = {},
): Promise<EvalReport> {
  return runRetrievalEval({
    indexDir: ":memory:",
    embedder: hashEmbedder,
    modes: ALL_MODES,
    gitSha: opts.gitSha ?? "hash-gate",
    ...(opts.patchDeps ? { patchDeps: opts.patchDeps } : {}),
  });
}

/** rr is 1/rank rounded to 4 places; rank <= topK (10), so rounding back is exact. */
function rankOf(row: PerQueryRow): number | null | undefined {
  if (!row.metrics) return undefined;
  return row.metrics.rr > 0 ? Math.round(1 / row.metrics.rr) : null;
}

/** Freeze a report as per-query ranks (the hash-baseline.json shape). */
export function toRankBaseline(report: EvalReport): RankBaseline {
  return {
    $comment:
      "Frozen tier-0 hash-embedder ranks (#357) — see thresholds.json hashGate. Regenerate only via `pnpm eval:hash-freeze`, after committing any rule change (D-012).",
    embedder: "hash-fnv1a (test/eval/retrieval/hash-embedder.ts)",
    gitSha: report.meta.gitSha,
    queryCount: report.meta.queryCount,
    modes: report.meta.modes,
    perQuery: report.perQuery.map((r) => {
      const rank = rankOf(r);
      return { id: r.id, kind: r.kind, mode: r.mode, ...(rank !== undefined ? { rank } : {}), retrieved: r.retrieved };
    }),
  };
}
