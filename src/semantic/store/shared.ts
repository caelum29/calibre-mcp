// Small SQL/candidate helpers shared by the store's concern modules (#272): the bm25 column
// weights (also quoted in the schema's FTS comment), FTS MATCH building, author decoding,
// quiet rollback, and the per-library candidate-cache shape the chunk and figure halves share.

import type { DatabaseSync } from "node:sqlite";
import type { Candidate } from "../vector.js";

/** A raw node:sqlite result row. */
export type Row = Record<string, unknown>;

// bm25() per-column weights, in chunk_fts column order (body_stem, body, book_meta).
// book_meta (the stemmed title+authors) lets a query naming a book surface it even when the
// title never recurs in prose, but it must never dominate body matches — hence 0.5. Tune these
// ONLY through the retrieval eval (test/eval/retrieval), never by feel.
const BM25_WEIGHT_BODY_STEM = 1.0;
const BM25_WEIGHT_BODY = 1.0;
const BM25_WEIGHT_BOOK_META = 0.5;
/** Weighted bm25() over chunk_fts (body_stem, body, book_meta). */
export const WEIGHTED_BM25 = `bm25(chunk_fts, ${BM25_WEIGHT_BODY_STEM}, ${BM25_WEIGHT_BODY}, ${BM25_WEIGHT_BOOK_META})`;
// figure_fts mirrors the chunk weights: stemmed caption + raw caption 1.0, book identity 0.5.
export const WEIGHTED_FIG_BM25 = `bm25(figure_fts, ${BM25_WEIGHT_BODY_STEM}, ${BM25_WEIGHT_BODY}, ${BM25_WEIGHT_BOOK_META})`;

/**
 * Bundle-filter candidate restriction (#93): drop candidates outside the allowed book set
 * BEFORE exact brute-force ranking, so a filtered ranking is precisely the unfiltered one
 * intersected with the set — never a post-hoc truncation that loses recall.
 */
export function restrict(cands: Candidate[], allow?: ReadonlySet<number>): Candidate[] {
  return allow === undefined ? cands : cands.filter((c) => allow.has(c.bookId));
}

/**
 * Decoded candidate vectors for one library, held in memory so vector queries don't
 * re-read/decode every embeddings BLOB from SQLite (seconds of I/O at full-library scale).
 * `byBook` holds references into the same Candidate objects as `all` — an index, not a copy.
 */
export interface CandidateCache {
  all: Candidate[];
  byBook: Map<number, Candidate[]>;
}

/** Group decoded candidates by book — `byBook` references the same objects as `all`. */
export function cacheOf(all: Candidate[]): CandidateCache {
  const byBook = new Map<number, Candidate[]>();
  for (const c of all) {
    const list = byBook.get(c.bookId);
    if (list) list.push(c);
    else byBook.set(c.bookId, [c]);
  }
  return { all, byBook };
}

/**
 * Roll back after a failed write without masking the original error: if BEGIN itself failed
 * (e.g. SQLITE_BUSY) or SQLite already rolled back, ROLLBACK throws "no transaction is active".
 */
export function rollbackQuietly(db: DatabaseSync): void {
  try {
    if (db.isTransaction) db.exec("ROLLBACK");
  } catch {
    // the caller rethrows the error that actually caused the failure
  }
}

/**
 * Build an FTS5 MATCH expression from an already-stemmed query. Tokens are OR-ed (recall-first;
 * RRF and the vector half restore precision) and phrase-quoted so punctuation/operators in a
 * token can't be parsed as FTS syntax. Returns null when the query has no searchable tokens.
 */
export function ftsMatch(stemmed: string): string | null {
  const toks = stemmed.split(/\s+/).filter(Boolean);
  if (toks.length === 0) return null;
  return toks.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

/** authors are stored as a JSON array string; tolerate legacy/garbled values. */
export function parseAuthors(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return raw ? [raw] : [];
  }
}
