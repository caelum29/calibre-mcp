// Chunk retrieval (#272): the vector half (brute-force cosine over a per-library in-memory
// candidate cache, decoded once, invalidated on any write) and the keyword half (weighted bm25
// over chunk_fts), plus figure → context lookup. Home for #243's snippet window.

import type { DatabaseSync } from "node:sqlite";
import type { LogSink } from "../../logging.js";
import { EMBED_DIM } from "../model.js";
import { stemText, stemmedTokens } from "../stem.js";
import { type Candidate, decodeVector, topK } from "../vector.js";
import type { IndexConnections } from "./schema.js";
import { type CandidateCache, cacheOf, ftsMatch, parseAuthors, restrict, type Row, WEIGHTED_BM25 } from "./shared.js";
import type { BookHit, ChunkIndex, ChunkRef, LibraryHit } from "./types.js";

/** Length of a result snippet (chars) taken from the best chunk. */
const SNIPPET_CHARS = 320;

/** ChunkIndex over the shared connections with its own per-library candidate cache. */
export class SqliteChunkIndex implements ChunkIndex {
  // Per-library candidate cache; invalidated wholesale on any write (correctness > cleverness).
  // DEFERRED: int8-quantize this in-memory copy (~99.8% recall at 4x smaller) once full-library indexing lands.
  #caches = new Map<string, CandidateCache>();

  constructor(
    private readonly conn: IndexConnections,
    private readonly log: LogSink,
    /** Reads + decodes a library's embedding BLOBs; injectable so the store keeps its spy seam. */
    private readonly load: (libraryId: string) => Candidate[] = (l) => loadChunkCandidates(conn.db(l)),
  ) {}

  /** Drop one library's cache (after any write). */
  invalidate(libraryId: string): void {
    this.#caches.delete(libraryId);
  }

  /** Drop every cache (store close). */
  clear(): void {
    this.#caches.clear();
  }

  searchLibrary(libraryId: string, query: Float32Array, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    const db = this.conn.db(libraryId);
    const cands = restrict(this.#candidates(libraryId), allow);
    const hits = topK(query, cands, Number.MAX_SAFE_INTEGER);

    // Keep the best chunk per book (hits are already sorted desc), up to k books.
    const bestPerBook = new Map<number, { chunkId: number; score: number }>();
    for (const h of hits) {
      if (!bestPerBook.has(h.bookId)) bestPerBook.set(h.bookId, { chunkId: h.chunkId, score: h.score });
      if (bestPerBook.size >= k) break;
    }

    const out: LibraryHit[] = [];
    for (const [bookId, best] of bestPerBook) {
      const book = db.prepare("SELECT title, authors FROM books WHERE book_id = ?").get(bookId) as Row;
      const chunk = db.prepare("SELECT char_start, char_end, body FROM chunks WHERE id = ?").get(best.chunkId) as Row;
      const body = String(chunk?.body ?? "");
      out.push({
        bookId,
        title: String(book?.title ?? `book ${bookId}`),
        authors: parseAuthors(book?.authors),
        score: best.score,
        snippet: body.slice(0, SNIPPET_CHARS),
        body,
        charStart: Number(chunk?.char_start ?? 0),
        charEnd: Number(chunk?.char_end ?? 0),
      });
    }
    return out; // already ordered: Map preserved best-first insertion
  }

  searchBook(libraryId: string, bookId: number, query: Float32Array, k: number): BookHit[] {
    const db = this.conn.db(libraryId);
    const hits = topK(query, this.#candidates(libraryId, bookId), k);
    return hits.map((h) => {
      const chunk = db
        .prepare("SELECT char_start, char_end, body, front_matter FROM chunks WHERE id = ?")
        .get(h.chunkId) as Row;
      return {
        chunkId: h.chunkId,
        charStart: Number(chunk?.char_start ?? 0),
        charEnd: Number(chunk?.char_end ?? 0),
        body: String(chunk?.body ?? ""),
        score: h.score,
        frontMatter: Number(chunk?.front_matter ?? 0) === 1,
      };
    });
  }

  searchLibraryFts(libraryId: string, stemmedQuery: string, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    const db = this.conn.db(libraryId);
    const match = ftsMatch(stemmedQuery);
    if (!match) return [];
    // Pull a generous pool of chunk hits, then keep the best (first, since bm25-ranked) per book.
    const pool = Math.max(k * 20, 200);
    // The allow filter lives in SQL (json_each keeps it to one variable) so a small bundle
    // can't be starved by the pool cap eating unfiltered hits first. It uses the same FTS-first
    // CTE as searchBookFts: ~9 s → <0.8 s on stop-word-heavy queries, neutral otherwise. The
    // unfiltered branch keeps the plain JOIN — the CTE measured no gain there.
    const rows = (
      allow === undefined
        ? db
            .prepare(
              `SELECT c.id AS chunk_id, c.book_id, c.char_start, c.char_end, c.body, ${WEIGHTED_BM25} AS score
               FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
               WHERE chunk_fts MATCH ? ORDER BY score LIMIT ?`,
            )
            .all(match, pool)
        : db
            .prepare(
              `WITH m AS MATERIALIZED (
                 SELECT rowid AS id, ${WEIGHTED_BM25} AS s FROM chunk_fts WHERE chunk_fts MATCH ?
               )
               SELECT c.id AS chunk_id, c.book_id, c.char_start, c.char_end, c.body, m.s AS score
               FROM m JOIN chunks c ON c.id = m.id
               WHERE c.book_id IN (SELECT value FROM json_each(?))
               ORDER BY m.s LIMIT ?`,
            )
            .all(match, JSON.stringify([...allow]), pool)
    ) as Row[];

    const seen = new Set<number>();
    const out: LibraryHit[] = [];
    for (const r of rows) {
      const bookId = Number(r.book_id);
      if (seen.has(bookId)) continue;
      seen.add(bookId);
      const book = db.prepare("SELECT title, authors FROM books WHERE book_id = ?").get(bookId) as Row;
      const body = String(r.body ?? "");
      out.push({
        bookId,
        title: String(book?.title ?? `book ${bookId}`),
        authors: parseAuthors(book?.authors),
        score: Number(r.score), // bm25: negative, lower (more negative) is a better match
        snippet: body.slice(0, SNIPPET_CHARS),
        body,
        charStart: Number(r.char_start),
        charEnd: Number(r.char_end),
      });
      if (out.length >= k) break;
    }
    return out;
  }

  searchBookFts(libraryId: string, bookId: number, stemmedQuery: string, k: number): BookHit[] {
    const db = this.conn.db(libraryId);
    const match = ftsMatch(stemmedQuery);
    if (!match) return [];
    // FTS-first: with a plain JOIN the planner drives from idx_chunks_book and re-runs the
    // OR-ed MATCH per chunk (1.7–250 s on a 313k-chunk index); a MATERIALIZED CTE evaluates
    // MATCH once, then filters by book. Same rows, same bm25 scores.
    const rows = db
      .prepare(
        `WITH m AS MATERIALIZED (
           SELECT rowid AS id, ${WEIGHTED_BM25} AS s FROM chunk_fts WHERE chunk_fts MATCH ?
         )
         SELECT c.id AS chunk_id, c.char_start, c.char_end, c.body, c.front_matter, m.s AS score
         FROM m JOIN chunks c ON c.id = m.id
         WHERE c.book_id = ? ORDER BY m.s LIMIT ?`,
      )
      .all(match, bookId, k) as Row[];
    return rows.map((r) => ({
      chunkId: Number(r.chunk_id),
      charStart: Number(r.char_start),
      charEnd: Number(r.char_end),
      body: String(r.body ?? ""),
      score: Number(r.score),
      frontMatter: Number(r.front_matter ?? 0) === 1,
    }));
  }

  chunkAt(libraryId: string, bookId: number, charOffset: number): ChunkRef | undefined {
    const db = this.conn.db(libraryId);
    // Half-open [start, end): D-018 says "BETWEEN charStart AND charEnd", but inclusive ends
    // would match TWO chunks when a marker sits exactly on a boundary — the marker's text
    // begins at the boundary, so the LATER chunk (start == offset) is the one containing it.
    const row = db
      .prepare(
        `SELECT id, char_start, char_end, body, front_matter FROM chunks
         WHERE book_id = ? AND char_start <= ? AND char_end > ? LIMIT 1`,
      )
      .get(bookId, charOffset, charOffset) as Row | undefined;
    if (!row) return undefined;
    return {
      chunkId: Number(row.id),
      charStart: Number(row.char_start),
      charEnd: Number(row.char_end),
      body: String(row.body ?? ""),
      frontMatter: Number(row.front_matter ?? 0) === 1,
    };
  }

  /** Candidate vectors — all of a library, or one book (the doc's book-scope subarray). */
  #candidates(libraryId: string, bookId?: number): Candidate[] {
    let cache = this.#caches.get(libraryId);
    if (!cache) {
      const all = this.load(libraryId);
      cache = cacheOf(all);
      this.#caches.set(libraryId, cache);
      // Memory honesty: vectors dominate (EMBED_DIM float32 each); ids/objects are noise.
      const mib = (all.length * EMBED_DIM * 4) / (1024 * 1024);
      this.log.info("semantic candidate cache built", {
        library: libraryId,
        chunks: all.length,
        approxMiB: Number(mib.toFixed(1)),
      });
    }
    return bookId === undefined ? cache.all : (cache.byBook.get(bookId) ?? []);
  }
}

/**
 * Read + decode ALL embedding BLOBs of a library from SQLite — the expensive path the
 * candidate cache exists to avoid. `decodeVector` copies each BLOB into a fresh
 * Float32Array, so cached vectors never alias sqlite's pooled buffers.
 */
export function loadChunkCandidates(db: DatabaseSync): Candidate[] {
  const rows = db.prepare("SELECT chunk_id, book_id, vector FROM embeddings").all() as Row[];
  return rows.map((r) => ({
    chunkId: Number(r.chunk_id),
    bookId: Number(r.book_id),
    vector: decodeVector(r.vector as Uint8Array),
  }));
}

// Snippet window (#243): show the part of the chunk that matched, not its head. Display only —
// ranking never reads it. Query terms shorter than this are skipped (в, и, of, to: noise).
const MIN_TERM_CHARS = 3;
// How far back from the first matched term to look for its sentence start.
const MAX_SENTENCE_LEAD = 160;
const SENTENCE_END = /[.!?…]\s+|\n/g;

/** Where a snippet of `body` starts (chunk-relative) and its text, "…"-prefixed when cut. */
export interface SnippetWindow {
  start: number;
  text: string;
}

/**
 * Pick the `width`-char window of a chunk with the most distinct query terms (then the most
 * term hits, then the earliest), starting at the sentence that holds its first term. Terms are
 * matched on stems, the same transform the keyword half uses, so Cyrillic inflections match.
 * Falls back to the chunk head when no term occurs (a semantic-only hit) or the chunk is short.
 */
export function snippetWindow(body: string, query: string, width: number = SNIPPET_CHARS): SnippetWindow {
  const head = { start: 0, text: body.slice(0, width) };
  if (body.length <= width) return head;
  const terms = new Set(
    stemText(query)
      .split(" ")
      .filter((t) => t.length >= MIN_TERM_CHARS),
  );
  if (terms.size === 0) return head;
  const hits = [...stemmedTokens(body)].filter((t) => terms.has(t.stem));
  if (hits.length === 0) return head;

  let best = { start: 0, distinct: 0, count: 0 };
  for (const anchor of hits) {
    const start = sentenceStart(body, anchor.index);
    const inside = hits.filter((h) => h.index >= start && h.index + h.length <= start + width);
    const distinct = new Set(inside.map((h) => h.stem)).size;
    if (distinct > best.distinct || (distinct === best.distinct && inside.length > best.count)) {
      best = { start, distinct, count: inside.length };
    }
  }
  const text = body.slice(best.start, best.start + width);
  return { start: best.start, text: best.start > 0 ? `…${text}` : text };
}

/** Start of the sentence holding `at`, if it begins within MAX_SENTENCE_LEAD chars; else `at`. */
function sentenceStart(body: string, at: number): number {
  const from = Math.max(0, at - MAX_SENTENCE_LEAD);
  let start = from === 0 ? 0 : at;
  for (const m of body.slice(from, at).matchAll(SENTENCE_END)) start = from + m.index + m[0].length;
  return start;
}
