// Small SQL/candidate helpers shared by the store's concern modules (#272): the bm25 column
// weights (also quoted in the schema's FTS comment), FTS MATCH building (rendered from the #651
// keyword plan when the library's term statistics are at hand), author decoding,
// quiet rollback, and the per-library candidate-cache shape the chunk and figure halves share.

import type { DatabaseSync } from "node:sqlite";
import {
  type KeywordDrop,
  type KeywordToken,
  planKeywordQuery,
  type TermStats,
} from "../../domain/search/keyword-plan.js";
import { queryStemmedTokens } from "../stem.js";
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
 * What any per-library vector cache records to decide its own freshness (#337, #370): the chunk
 * matrix (chunk-matrix.ts) and the figure candidate cache share one refresh decision.
 */
export interface CacheVersion {
  /** `PRAGMA data_version` when the cache was read: another connection's commit changes it (#337). */
  dataVersion: number;
  /** Per-book stamp of the `books` row the vectors were read under (#370): diffed to reload only changed books. */
  stamps: Map<number, string>;
  /** Books this connection wrote since the read — its own commits never move data_version. */
  dirty: Set<number>;
}

/**
 * Decoded candidate vectors for one library, held in memory so vector queries don't
 * re-read/decode every embeddings BLOB from SQLite (seconds of I/O at full-library scale).
 * `byBook` holds references into the same Candidate objects as `all` — an index, not a copy.
 * The figure cache keeps this shape; chunks moved to the packed matrix (#618).
 */
export interface CandidateCache extends CacheVersion {
  all: Candidate[];
  byBook: Map<number, Candidate[]>;
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

/**
 * The refresh decision for a cached library: `hit` when nothing committed since the read (and
 * no own write); `cold` with no cache yet; otherwise `stale` with the books to drop — `stamps`
 * changed, own-written, or gone — and, of those, the ones still present to re-read. A
 * neighbour's close() checkpoint moves data_version but no stamp, so it costs one stamp read
 * and an empty `stale`, never a re-decode (#370).
 */
export type Freshness =
  | { kind: "hit" }
  | { kind: "cold"; dataVersion: number; stamps: Map<number, string> }
  | { kind: "stale"; dataVersion: number; stamps: Map<number, string>; stale: Set<number>; reload: number[] };

/** Decide how the cache `old` must refresh on `db` (see `Freshness`). */
export function cacheFreshness(db: DatabaseSync, old: CacheVersion | undefined): Freshness {
  // Stamp BEFORE reading vectors: a commit landing in between only costs one needless reload,
  // whereas stamping after could pin pre-commit vectors to the post-commit version.
  const version = dataVersion(db);
  if (old && old.dataVersion === version && old.dirty.size === 0) return { kind: "hit" };
  const stamps = bookStamps(db);
  if (!old) return { kind: "cold", dataVersion: version, stamps };
  const stale = new Set(old.dirty);
  for (const [id, stamp] of stamps) if (old.stamps.get(id) !== stamp) stale.add(id);
  for (const id of old.stamps.keys()) if (!stamps.has(id)) stale.add(id);
  const reload = [...stale].filter((id) => stamps.has(id));
  return { kind: "stale", dataVersion: version, stamps, stale, reload };
}

/** Loaders for one cache: the whole library (cold) and a set of books (refresh). */
export interface CandidateLoaders {
  all: () => Candidate[];
  books: (bookIds: number[]) => Candidate[];
}

/**
 * The figure cache of a library, current as of this call (decision: `cacheFreshness`): only
 * stale books are re-read, deleted books dropped. `built` is set on a cold (full) load.
 */
export function refreshedCache(
  db: DatabaseSync,
  caches: Map<string, CandidateCache>,
  libraryId: string,
  load: CandidateLoaders,
): { cache: CandidateCache; built: boolean } {
  const old = caches.get(libraryId);
  const fresh = cacheFreshness(db, old);
  if (fresh.kind === "hit") return { cache: old!, built: false };
  if (fresh.kind === "cold") {
    const cache = cacheOf(load.all(), fresh.dataVersion, fresh.stamps);
    caches.set(libraryId, cache);
    return { cache, built: true };
  }
  const byBook = new Map(old!.byBook);
  for (const id of fresh.stale) byBook.delete(id);
  for (const c of load.books(fresh.reload)) {
    const list = byBook.get(c.bookId);
    if (list) list.push(c);
    else byBook.set(c.bookId, [c]);
  }
  // Rowid order, as a cold load scans it: topK's tie-break is total since #392, so this no longer
  // decides any ranking; it keeps a refreshed cache identical to a fresh one (cheap, predictable).
  const all = [...byBook.values()].flat().sort((x, y) => x.chunkId - y.chunkId);
  const cache: CandidateCache = {
    all,
    byBook,
    dataVersion: fresh.dataVersion,
    stamps: fresh.stamps,
    dirty: new Set(),
  };
  caches.set(libraryId, cache);
  return { cache, built: false };
}

/** Mark books this connection wrote, so the next read reloads exactly them (own commits leave data_version alone). */
export function markDirty<C extends CacheVersion>(
  caches: Map<string, C>,
  libraryId: string,
  bookIds: readonly number[],
): void {
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

// A raw token as the index's tokenizer sees it: letters, digits, marks and the tokenchars
// `_ + # . -` of chunk_fts/figure_fts (schema.ts). Identifier-like = it also holds `+ # . -`.
const RAW_TOKEN = /[\p{L}\p{N}\p{M}_+#.-]+/gu;
const ID_CHAR = /[+#.-]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Distinct identifier-like raw tokens of a query (c++, c#, node.js), case-folded, trailing periods stripped. */
function identifierTokens(query: string): string[] {
  const out = new Set<string>();
  for (const m of query.matchAll(RAW_TOKEN)) {
    const tok = m[0].replace(/\.+$/, "").toLowerCase();
    if (ID_CHAR.test(tok) && WORD_CHAR.test(tok)) out.add(tok);
  }
  return [...out];
}

const phrase = (t: string): string => `"${t.replaceAll('"', '""')}"`;

/**
 * Build an FTS5 MATCH expression from the query as typed (#634). Its stems are OR-ed
 * (recall-first; RRF and the vector half restore precision), then each identifier-like raw token
 * joins as "t" and "t." — FTS5 runs a quoted string through the table's own tokenizer, so `c++`
 * stays whole and can only match the raw column, and `t.` reaches the sentence-final form the
 * tokenizer stores with its period. A query without such a token gets exactly the stems-only
 * MATCH. Phrase-quoting keeps operators in a token from being parsed as FTS syntax. Returns null
 * when the query has no searchable tokens. `langs` are the book languages of the searched library
 * (#654): an ambiguous token joins with one stem per candidate language pack.
 */
export function ftsMatch(query: string, langs?: ReadonlySet<string | undefined>): string | null {
  const stems = queryStems(query, langs);
  const ids = identifierTokens(query).flatMap((t) => [t, `${t}.`]);
  const toks = [...stems, ...ids];
  if (toks.length === 0) return null;
  return toks.map(phrase).join(" OR ");
}

// #651 prune rule, declared 2026-11-17 before any judged run: FTS5 already floors the IDF of a
// term in more than half the rows, so pruning those is near ranking-neutral and saves their
// long posting lists. Bigrams and quoted phrases wait for their own judged arm.
const MAX_DOC_SHARE = 0.5;
// FTS5 column filter of the stemmed columns (body_stem holds the stemmed text, book_meta the
// stemmed title+authors); body is the raw column
const STEM_COLUMNS = "{body_stem book_meta}";

/** The keyword half's MATCH and, when it came from the #651 plan, what the plan left out. */
export interface KeywordMatch {
  /** FTS5 MATCH expression; null when the query has no searchable tokens. */
  match: string | null;
  /** Terms left out (duplicate / too-common); absent when no plan ran (no statistics, or they failed). */
  dropped?: KeywordDrop[];
}

/**
 * The keyword half's MATCH rendered from the #651 plan over one library's `stats`: distinct
 * stems, minus those in more than half of the chunks (body_stem), plus the identifier extras
 * of ftsMatch except an identifier whose stems were all pruned ("a pruned token leaves both
 * groups"). The stems match only the stemmed columns (option b, no exact-form bonus); the
 * identifier extras stay unfiltered. Without statistics, or when they fail, the MATCH is exactly
 * ftsMatch(query, langs). Stem variants of one word (#654) are separate plan tokens, so a variant
 * equal to another stem is dropped as a duplicate and each is priced on its own before pruning.
 */
export function keywordMatch(query: string, stats?: TermStats, langs?: ReadonlySet<string | undefined>): KeywordMatch {
  if (stats === undefined) return { match: ftsMatch(query, langs) };
  let plan;
  try {
    plan = planKeywordQuery(keywordTokens(query, langs), stats, { maxDocShare: MAX_DOC_SHARE, bigrams: false });
  } catch {
    // a vocab lookup can fail mid-plan (busy file, missing module): today's MATCH still answers
    return { match: ftsMatch(query, langs) };
  }
  const pruned = new Set(plan.dropped.filter((d) => d.reason === "too-common").map((d) => d.term));
  const dropped = [...plan.dropped];
  const ids: string[] = [];
  for (const id of identifierTokens(query)) {
    const stems = queryStems(id, langs);
    if (stems.length > 0 && stems.every((s) => pruned.has(s))) dropped.push({ term: id, reason: "too-common" });
    else ids.push(id, `${id}.`);
  }
  // #651 option (b): stems only in the stemmed columns, so a stem equal to its surface form no
  // longer also matches the raw body column (the accidental exact-form bonus); the identifier
  // forms stay raw and unfiltered, as #634 placed them
  const parts = plan.terms.length > 0 ? [`${STEM_COLUMNS} : (${plan.terms.map(phrase).join(" OR ")})`] : [];
  parts.push(...ids.map(phrase));
  return { match: parts.length === 0 ? null : parts.join(" OR "), dropped };
}

// a double-quoted span of the query, as typed; an unpaired quote opens none
const QUOTED = /"([^"]*)"/g;

/** Every stem variant of the query's words, in query order (#654). */
function queryStems(query: string, langs: ReadonlySet<string | undefined> | undefined): string[] {
  return [...queryStemmedTokens(query, langs)].flatMap((t) => t.stems);
}

/**
 * The query's word tokens in order (stemText's tokenizer), one per stem variant, each tagged with
 * its quoted span. Only a word's first variant carries the span: the planner builds a quoted
 * phrase from the span's raw words, which must not repeat.
 */
function keywordTokens(query: string, langs: ReadonlySet<string | undefined> | undefined): KeywordToken[] {
  const spans = [...query.matchAll(QUOTED)].map((m) => ({ from: m.index + 1, to: m.index + m[0].length - 1 }));
  return [...queryStemmedTokens(query, langs)].flatMap((t) => {
    const span = spans.findIndex((s) => t.index >= s.from && t.index + t.length <= s.to);
    const raw = query.slice(t.index, t.index + t.length);
    return t.stems.map((stem, i) => ({ stem, raw, ...(span >= 0 && i === 0 ? { span } : {}) }));
  });
}

/** The book languages (#654) of a library's indexed books: the query side's candidate packs. */
export function libraryLanguages(db: DatabaseSync): Set<string | undefined> {
  // NULL (no detected language, or written before #654) stays in as undefined: those books stem
  // with the script default, which must stay a query candidate (#716 review).
  const rows = db.prepare("SELECT DISTINCT lang FROM books").all() as Row[];
  return new Set(rows.map((r) => (typeof r.lang === "string" ? r.lang : undefined)));
}

/** authors are stored as a JSON array string; tolerate legacy/garbled values. */
export function parseAuthors(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return raw ? [raw] : [];
  }
}
