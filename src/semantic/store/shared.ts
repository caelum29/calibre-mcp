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
  /** `PRAGMA data_version` when the cache was read: another connection's commit changes it (#337). */
  dataVersion: number;
  /** Per-book stamp of the `books` row the vectors were read under (#370): diffed to reload only changed books. */
  stamps: Map<number, string>;
  /** Books this connection wrote since the read — its own commits never move data_version. */
  dirty: Set<number>;
}

/** Group decoded candidates by book — `byBook` references the same objects as `all`. */
export function cacheOf(all: Candidate[], dataVersion: number, stamps: Map<number, string>): CandidateCache {
  const byBook = new Map<number, Candidate[]>();
  for (const c of all) {
    const list = byBook.get(c.bookId);
    if (list) list.push(c);
    else byBook.set(c.bookId, [c]);
  }
  return { all, byBook, dataVersion, stamps, dirty: new Set() };
}

/**
 * `PRAGMA data_version` of this connection: it changes when ANOTHER connection (the second
 * server sharing the index file, #196) commits, never on this connection's own commits — those
 * mark their books dirty instead. Must be read on the connection that serves the cache.
 */
export function dataVersion(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA data_version").get() as Row).data_version);
}

/**
 * Per-book stamp from columns every write already sets (no schema change): replaceBook
 * re-inserts the row with a fresh `indexed_at`, deleteBooks removes it, refreshBookMeta bumps
 * `indexed_at`. Blind spot: another process re-writing one book twice in the same millisecond
 * with equal counts, with our read landing in between — own writes are tracked exactly.
 */
export function bookStamps(db: DatabaseSync): Map<number, string> {
  const rows = db.prepare("SELECT book_id, indexed_at, chunk_count, embedded_chunks FROM books").all() as Row[];
  return new Map(rows.map((r) => [Number(r.book_id), `${r.indexed_at}|${r.chunk_count}|${r.embedded_chunks}`]));
}

/** Loaders for one cache: the whole library (cold) and a set of books (refresh). */
export interface CandidateLoaders {
  all: () => Candidate[];
  books: (bookIds: number[]) => Candidate[];
}

/**
 * The library's cache, current as of this call: hit when nothing committed since the read;
 * otherwise only books whose `books` stamp changed (or that this connection wrote) are re-read,
 * deleted books dropped — a neighbour's close() checkpoint moves data_version but no stamp, so
 * it costs one stamp read, not a re-decode (#370). `built` is set on a cold (full) load.
 */
export function refreshedCache(
  db: DatabaseSync,
  caches: Map<string, CandidateCache>,
  libraryId: string,
  load: CandidateLoaders,
): { cache: CandidateCache; built: boolean } {
  // Stamp BEFORE reading vectors: a commit landing in between only costs one needless reload,
  // whereas stamping after could pin pre-commit vectors to the post-commit version.
  const version = dataVersion(db);
  const old = caches.get(libraryId);
  if (old && old.dataVersion === version && old.dirty.size === 0) return { cache: old, built: false };
  const stamps = bookStamps(db);
  if (!old) {
    const cache = cacheOf(load.all(), version, stamps);
    caches.set(libraryId, cache);
    return { cache, built: true };
  }
  const byBook = new Map(old.byBook);
  const stale = new Set(old.dirty);
  for (const [id, stamp] of stamps) if (old.stamps.get(id) !== stamp) stale.add(id);
  for (const id of old.stamps.keys()) if (!stamps.has(id)) stale.add(id);
  for (const id of stale) byBook.delete(id);
  for (const c of load.books([...stale].filter((id) => stamps.has(id)))) {
    const list = byBook.get(c.bookId);
    if (list) list.push(c);
    else byBook.set(c.bookId, [c]);
  }
  // Rowid order, as a cold load scans it, so tie-breaking in topK matches a fresh cache.
  const all = [...byBook.values()].flat().sort((x, y) => x.chunkId - y.chunkId);
  const cache: CandidateCache = { all, byBook, dataVersion: version, stamps, dirty: new Set() };
  caches.set(libraryId, cache);
  return { cache, built: false };
}

/** Mark books this connection wrote, so the next read reloads exactly them (own commits leave data_version alone). */
export function markDirty(caches: Map<string, CandidateCache>, libraryId: string, bookIds: readonly number[]): void {
  const cache = caches.get(libraryId);
  if (cache) for (const id of bookIds) cache.dirty.add(id);
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
