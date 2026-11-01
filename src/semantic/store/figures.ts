// Figure-caption retrieval (#272, D-018): caption vectors (own per-library cache — the
// Candidate.chunkId slot holds the figures rowid) + weighted bm25 over figure_fts, and the
// text-span → figures direction. Pointers + captions only, never pixels.

import type { DatabaseSync } from "node:sqlite";
import { decodeVector, topK, type Candidate } from "../vector.js";
import type { IndexConnections } from "./schema.js";
import {
  type CandidateCache,
  cacheOf,
  currentCache,
  dataVersion,
  ftsMatch,
  parseAuthors,
  restrict,
  type Row,
  WEIGHTED_FIG_BM25,
} from "./shared.js";
import type { FigureHit, FigureIndex, FigureRef } from "./types.js";

/** FigureIndex over the shared connections with its own figure-vector cache. */
export class SqliteFigureIndex implements FigureIndex {
  // Figure-caption vectors, cached separately (Candidate.chunkId holds the figures rowid here).
  #caches = new Map<string, CandidateCache>();

  constructor(private readonly conn: IndexConnections) {}

  /** Drop one library's cache (after any write). */
  invalidate(libraryId: string): void {
    this.#caches.delete(libraryId);
  }

  /** Drop every cache (store close). */
  clear(): void {
    this.#caches.clear();
  }

  searchFigures(
    libraryId: string,
    query: Float32Array,
    k: number,
    bookId?: number,
    allow?: ReadonlySet<number>,
  ): FigureHit[] {
    const db = this.conn.db(libraryId);
    const hits = topK(query, restrict(this.#candidates(libraryId, bookId), allow), k);
    return hits.map((h) => this.#figureHit(db, h.chunkId, h.score)).filter((h): h is FigureHit => h !== undefined);
  }

  searchFiguresFts(
    libraryId: string,
    stemmedQuery: string,
    k: number,
    bookId?: number,
    allow?: ReadonlySet<number>,
  ): FigureHit[] {
    const db = this.conn.db(libraryId);
    const match = ftsMatch(stemmedQuery);
    if (!match) return [];
    let rows: Row[];
    if (bookId !== undefined) {
      rows = db
        .prepare(
          `SELECT f.id AS fig_id, ${WEIGHTED_FIG_BM25} AS score
           FROM figure_fts JOIN figures f ON f.id = figure_fts.rowid
           WHERE figure_fts MATCH ? AND f.book_id = ? ORDER BY score LIMIT ?`,
        )
        .all(match, bookId, k) as Row[];
    } else if (allow !== undefined) {
      rows = db
        .prepare(
          `SELECT f.id AS fig_id, ${WEIGHTED_FIG_BM25} AS score
           FROM figure_fts JOIN figures f ON f.id = figure_fts.rowid
           WHERE figure_fts MATCH ? AND f.book_id IN (SELECT value FROM json_each(?))
           ORDER BY score LIMIT ?`,
        )
        .all(match, JSON.stringify([...allow]), k) as Row[];
    } else {
      rows = db
        .prepare(
          `SELECT f.id AS fig_id, ${WEIGHTED_FIG_BM25} AS score
           FROM figure_fts JOIN figures f ON f.id = figure_fts.rowid
           WHERE figure_fts MATCH ? ORDER BY score LIMIT ?`,
        )
        .all(match, k) as Row[];
    }
    return rows
      .map((r) => this.#figureHit(db, Number(r.fig_id), Number(r.score)))
      .filter((h): h is FigureHit => h !== undefined);
  }

  figureCount(libraryId: string, bookId?: number): number {
    // Same no-side-effect guard as vectorCount: a read must never create a db file.
    if (!this.conn.has(libraryId)) return 0;
    const db = this.conn.db(libraryId);
    const row =
      bookId === undefined
        ? (db.prepare("SELECT COUNT(*) AS n FROM figures").get() as Row)
        : (db.prepare("SELECT COUNT(*) AS n FROM figures WHERE book_id = ?").get(bookId) as Row);
    return Number(row?.n ?? 0);
  }

  figuresInSpan(libraryId: string, bookId: number, charStart: number, charEnd: number): FigureRef[] {
    const db = this.conn.db(libraryId);
    const rows = db
      .prepare(
        `SELECT fig_index, page, caption, char_offset, format, source FROM figures
         WHERE book_id = ? AND char_offset >= ? AND char_offset < ? ORDER BY char_offset`,
      )
      .all(bookId, charStart, charEnd) as Row[];
    return rows.map((r) => ({
      figIndex: Number(r.fig_index),
      page: Number(r.page),
      caption: String(r.caption ?? ""),
      charOffset: Number(r.char_offset),
      format: String(r.format ?? ""),
      ...(r.source != null ? { source: String(r.source) } : {}),
    }));
  }

  /** Materialize one figures row (+ its book identity) into a FigureHit. */
  #figureHit(db: DatabaseSync, figRowId: number, score: number): FigureHit | undefined {
    const r = db
      .prepare("SELECT book_id, fig_index, page, caption, char_offset, format, source FROM figures WHERE id = ?")
      .get(figRowId) as Row | undefined;
    if (!r) return undefined;
    const bookId = Number(r.book_id);
    const book = db.prepare("SELECT title, authors FROM books WHERE book_id = ?").get(bookId) as Row;
    return {
      figureId: figRowId,
      bookId,
      title: String(book?.title ?? `book ${bookId}`),
      authors: parseAuthors(book?.authors),
      figIndex: Number(r.fig_index),
      page: Number(r.page),
      caption: String(r.caption ?? ""),
      charOffset: Number(r.char_offset),
      format: String(r.format ?? ""),
      ...(r.source != null ? { source: String(r.source) } : {}),
      score,
    };
  }

  /** Figure-caption vectors — all of a library, or one book. Mirrors #candidates. */
  #candidates(libraryId: string, bookId?: number): Candidate[] {
    const db = this.conn.db(libraryId);
    const version = dataVersion(db); // stamped before the read, as in chunks.ts (#337)
    let cache = currentCache(this.#caches, libraryId, version);
    if (!cache) {
      const rows = db.prepare("SELECT id, book_id, vector FROM figures WHERE vector IS NOT NULL").all() as Row[];
      const all = rows.map((r) => ({
        chunkId: Number(r.id), // Candidate.chunkId doubles as the figures rowid here
        bookId: Number(r.book_id),
        vector: decodeVector(r.vector as Uint8Array),
      }));
      cache = cacheOf(all, version);
      this.#caches.set(libraryId, cache);
    }
    return bookId === undefined ? cache.all : (cache.byBook.get(bookId) ?? []);
  }
}
