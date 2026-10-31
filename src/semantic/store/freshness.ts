// Freshness / coverage reads over the index (#272): has-index, provenance meta, vector
// coverage, indexed ids and counts. Diagnostic reads (calibre_ping) never create a db file —
// each guards on IndexConnections.has first. Home for #244's content fingerprint.

import type { DatabaseSync } from "node:sqlite";
import type { ChunkSpan } from "../content-match.js";
import type { IndexConnections } from "./schema.js";
import type { Row } from "./shared.js";
import type { IndexFreshness, IndexMeta } from "./types.js";

/** IndexFreshness over the shared per-library connections. */
export class SqliteFreshness implements IndexFreshness {
  constructor(private readonly conn: IndexConnections) {}

  hasIndex(libraryId: string): boolean {
    return this.conn.has(libraryId);
  }

  indexMeta(libraryId: string): IndexMeta | undefined {
    return this.conn.peekMeta(libraryId);
  }

  hasVectors(libraryId: string): boolean {
    if (!this.conn.has(libraryId)) return false;
    const db = this.conn.db(libraryId);
    return db.prepare("SELECT 1 FROM embeddings LIMIT 1").get() !== undefined;
  }

  isBookIndexed(
    libraryId: string,
    bookId: number,
    lastModified?: string,
    opts: { requireVectors?: boolean } = {},
  ): boolean {
    const db = this.conn.db(libraryId);
    const row = db.prepare("SELECT last_modified FROM books WHERE book_id = ?").get(bookId) as Row | undefined;
    if (!row) return false;
    if (lastModified !== undefined && String(row.last_modified ?? "") !== lastModified) return false;
    if (!opts.requireVectors) return true;
    // A keyword-only writer (e.g. a model-less .mcpb sharing this db) leaves chunks without
    // embeddings; a semantic build must re-index those instead of skipping them as fresh.
    const v = vectorCoverage(db, bookId);
    return v !== undefined && v.chunks > 0 && v.embedded >= v.chunks;
  }

  bookVectorCount(libraryId: string, bookId: number): number {
    if (!this.conn.has(libraryId)) return 0;
    return vectorCoverage(this.conn.db(libraryId), bookId)?.embedded ?? 0;
  }

  booksMissingVectors(libraryId: string): number {
    // A diagnostic read (calibre_ping) must never create a db file.
    if (!this.conn.has(libraryId)) return 0;
    const row = this.conn
      .db(libraryId)
      .prepare(
        // Legacy rows (embedded_chunks NULL, pre-#197) fall back to counting their embeddings.
        `SELECT COUNT(*) AS n FROM books b
         WHERE COALESCE(b.embedded_chunks, (SELECT COUNT(*) FROM embeddings e WHERE e.book_id = b.book_id)) < b.chunk_count`,
      )
      .get() as Row;
    return Number(row?.n ?? 0);
  }

  bookChunkSpans(libraryId: string, bookId: number): ChunkSpan[] {
    if (!this.conn.has(libraryId)) return [];
    return chunkSpans(this.conn.db(libraryId), bookId);
  }

  indexedBookIds(libraryId: string): number[] {
    if (!this.conn.has(libraryId)) return [];
    const rows = this.conn.db(libraryId).prepare("SELECT book_id FROM books").all() as Row[];
    return rows.map((r) => Number(r.book_id));
  }

  stats(libraryId: string): { books: number; chunks: number; figures: number } {
    const db = this.conn.db(libraryId);
    const books = db.prepare("SELECT COUNT(*) AS n FROM books").get() as Row;
    const chunks = db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as Row;
    const figures = db.prepare("SELECT COUNT(*) AS n FROM figures").get() as Row;
    return {
      books: Number(books?.n ?? 0),
      chunks: Number(chunks?.n ?? 0),
      figures: Number(figures?.n ?? 0),
    };
  }

  vectorCount(libraryId: string): number {
    // Guard so a diagnostic read (calibre_ping) never creates a db file for a library
    // that was never indexed.
    if (!this.conn.has(libraryId)) return 0;
    const row = this.conn.db(libraryId).prepare("SELECT COUNT(*) AS n FROM embeddings").get() as Row;
    return Number(row?.n ?? 0);
  }
}

/** A book's chunk count vs its embedded-chunk count, or undefined when it isn't indexed. */
export function vectorCoverage(db: DatabaseSync, bookId: number): { chunks: number; embedded: number } | undefined {
  const row = db.prepare("SELECT chunk_count, embedded_chunks FROM books WHERE book_id = ?").get(bookId) as
    | Row
    | undefined;
  if (!row) return undefined;
  let embedded = row.embedded_chunks;
  if (embedded == null) {
    // Legacy row (written before embedded_chunks existed) — count its embeddings instead.
    const n = db.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE book_id = ?").get(bookId) as Row;
    embedded = n?.n;
  }
  return { chunks: Number(row.chunk_count ?? 0), embedded: Number(embedded ?? 0) };
}

/** One book's stored chunk spans, sorted by charStart (the refresh re-check input). */
export function chunkSpans(db: DatabaseSync, bookId: number): ChunkSpan[] {
  const rows = db
    .prepare("SELECT char_start, char_end, body FROM chunks WHERE book_id = ? ORDER BY char_start, id")
    .all(bookId) as Row[];
  return rows.map((r) => ({ charStart: Number(r.char_start), charEnd: Number(r.char_end), body: String(r.body) }));
}
