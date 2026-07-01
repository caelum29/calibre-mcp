// SQLite-backed vector index for semantic search. Uses node:sqlite (built into Node 22.5+),
// so the npx/MCPB bundle ships with ZERO native addons — no node-gyp, no ABI lock, no macOS
// quarantine on a prebuilt .node (the exact install failure the project avoids). Vectors are
// L2-normalized Float32 BLOBs; retrieval is in-memory brute-force cosine (== dot product).
//
// The store is keyed per Calibre library: each library gets its own <indexDir>/<lib>.sqlite,
// opened lazily so read-only sessions that never build an index create no files. The index db
// is PERSISTENT (survives reboots) — unlike the regenerable extract cache in tmp.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "./model.js";
import { stemText } from "./stem.js";
import { type Candidate, decodeVector, encodeVector, topK } from "./vector.js";

/** A chunk ready to index: its span in the source text plus its embedding. */
export interface IndexedChunk {
  charStart: number;
  charEnd: number;
  body: string;
  vector: Float32Array;
}

/** Book identity cached in the index so results/resource_links work without a live fetch. */
export interface BookMeta {
  bookId: number;
  title: string;
  authors: string[];
  lastModified?: string;
}

/** A library-scope hit: the best-matching chunk of a book. */
export interface LibraryHit {
  bookId: number;
  title: string;
  authors: string[];
  score: number;
  snippet: string;
  charStart: number;
  charEnd: number;
}

/** A book-scope hit: one passage within the book. */
export interface BookHit {
  chunkId: number;
  charStart: number;
  charEnd: number;
  body: string;
  score: number;
}

export interface IndexStore {
  /** Cheap, side-effect-free check for an existing index (no db file is created). */
  hasIndex(libraryId: string): boolean;
  /** True if the book is indexed; when `lastModified` is given, also that it's up to date. */
  isBookIndexed(libraryId: string, bookId: number, lastModified?: string): boolean;
  /** Replace all of a book's chunks/embeddings atomically (idempotent re-index). */
  replaceBook(libraryId: string, meta: BookMeta, chunks: IndexedChunk[]): void;
  /** Rank books by their single best-matching chunk (best chunk per book), vector cosine. */
  searchLibrary(libraryId: string, query: Float32Array, k: number): LibraryHit[];
  /** Rank passages within one book, vector cosine. */
  searchBook(libraryId: string, bookId: number, query: Float32Array, k: number): BookHit[];
  /** Keyword half: rank books by best FTS5 bm25 match (score is negative, lower is better). */
  searchLibraryFts(libraryId: string, stemmedQuery: string, k: number): LibraryHit[];
  /** Keyword half: rank passages within one book by FTS5 bm25. */
  searchBookFts(libraryId: string, bookId: number, stemmedQuery: string, k: number): BookHit[];
  stats(libraryId: string): { books: number; chunks: number };
  close(): void;
}

/** Length of a result snippet (chars) taken from the best chunk. */
const SNIPPET_CHARS = 320;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS books (
  book_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL,
  last_modified TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  body TEXT NOT NULL,
  body_stem TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id);
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id),
  book_id INTEGER NOT NULL,
  vector BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emb_book ON embeddings(book_id);

-- Keyword half: FTS5 external-content index over chunks. body_stem holds EN+RU pre-stemmed
-- text (recall); body holds raw text (exact/identifier matches). tokenchars keep code tokens
-- (e.g. c++, __init__, api.v2) intact. Kept in sync with chunks via the triggers below.
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  body_stem, body,
  content='chunks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2 tokenchars ''-_+#.'''
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunk_fts(rowid, body_stem, body) VALUES (new.id, new.body_stem, new.body);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, body_stem, body) VALUES('delete', old.id, old.body_stem, old.body);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, body_stem, body) VALUES('delete', old.id, old.body_stem, old.body);
  INSERT INTO chunk_fts(rowid, body_stem, body) VALUES (new.id, new.body_stem, new.body);
END;
`;

type Row = Record<string, unknown>;

export class SqliteIndexStore implements IndexStore {
  #dbs = new Map<string, DatabaseSync>();

  constructor(private readonly cfg: Config) {}

  hasIndex(libraryId: string): boolean {
    if (this.#dbs.has(libraryId)) return true;
    if (this.cfg.indexDir === ":memory:") return false;
    return existsSync(this.#file(libraryId));
  }

  isBookIndexed(libraryId: string, bookId: number, lastModified?: string): boolean {
    const db = this.#db(libraryId);
    const row = db.prepare("SELECT last_modified FROM books WHERE book_id = ?").get(bookId) as
      | Row
      | undefined;
    if (!row) return false;
    if (lastModified === undefined) return true;
    return String(row.last_modified ?? "") === lastModified;
  }

  replaceBook(libraryId: string, meta: BookMeta, chunks: IndexedChunk[]): void {
    const db = this.#db(libraryId);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM embeddings WHERE book_id = ?").run(meta.bookId);
      db.prepare("DELETE FROM chunks WHERE book_id = ?").run(meta.bookId);
      db.prepare("DELETE FROM books WHERE book_id = ?").run(meta.bookId);

      db.prepare(
        "INSERT INTO books(book_id, title, authors, last_modified, chunk_count, indexed_at) VALUES(?,?,?,?,?,?)",
      ).run(
        meta.bookId,
        meta.title,
        JSON.stringify(meta.authors),
        meta.lastModified ?? null,
        chunks.length,
        new Date().toISOString(),
      );

      const insChunk = db.prepare(
        "INSERT INTO chunks(book_id, char_start, char_end, body, body_stem) VALUES(?,?,?,?,?)",
      );
      const insEmb = db.prepare("INSERT INTO embeddings(chunk_id, book_id, vector) VALUES(?,?,?)");
      for (const c of chunks) {
        // Pre-stem here so the FTS keyword half is populated by the insert trigger.
        const { lastInsertRowid } = insChunk.run(
          meta.bookId,
          c.charStart,
          c.charEnd,
          c.body,
          stemText(c.body),
        );
        insEmb.run(Number(lastInsertRowid), meta.bookId, encodeVector(c.vector));
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  searchLibrary(libraryId: string, query: Float32Array, k: number): LibraryHit[] {
    const db = this.#db(libraryId);
    const hits = topK(query, this.#candidates(db), Number.MAX_SAFE_INTEGER);

    // Keep the best chunk per book (hits are already sorted desc), up to k books.
    const bestPerBook = new Map<number, { chunkId: number; score: number }>();
    for (const h of hits) {
      if (!bestPerBook.has(h.bookId)) bestPerBook.set(h.bookId, { chunkId: h.chunkId, score: h.score });
      if (bestPerBook.size >= k) break;
    }

    const out: LibraryHit[] = [];
    for (const [bookId, best] of bestPerBook) {
      const book = db.prepare("SELECT title, authors FROM books WHERE book_id = ?").get(bookId) as Row;
      const chunk = db
        .prepare("SELECT char_start, char_end, body FROM chunks WHERE id = ?")
        .get(best.chunkId) as Row;
      out.push({
        bookId,
        title: String(book?.title ?? `book ${bookId}`),
        authors: parseAuthors(book?.authors),
        score: best.score,
        snippet: String(chunk?.body ?? "").slice(0, SNIPPET_CHARS),
        charStart: Number(chunk?.char_start ?? 0),
        charEnd: Number(chunk?.char_end ?? 0),
      });
    }
    return out; // already ordered: Map preserved best-first insertion
  }

  searchBook(libraryId: string, bookId: number, query: Float32Array, k: number): BookHit[] {
    const db = this.#db(libraryId);
    const hits = topK(query, this.#candidates(db, bookId), k);
    return hits.map((h) => {
      const chunk = db
        .prepare("SELECT char_start, char_end, body FROM chunks WHERE id = ?")
        .get(h.chunkId) as Row;
      return {
        chunkId: h.chunkId,
        charStart: Number(chunk?.char_start ?? 0),
        charEnd: Number(chunk?.char_end ?? 0),
        body: String(chunk?.body ?? ""),
        score: h.score,
      };
    });
  }

  searchLibraryFts(libraryId: string, stemmedQuery: string, k: number): LibraryHit[] {
    const db = this.#db(libraryId);
    const match = ftsMatch(stemmedQuery);
    if (!match) return [];
    // Pull a generous pool of chunk hits, then keep the best (first, since bm25-ranked) per book.
    const pool = Math.max(k * 20, 200);
    const rows = db
      .prepare(
        `SELECT c.id AS chunk_id, c.book_id, c.char_start, c.char_end, c.body, bm25(chunk_fts) AS score
         FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
         WHERE chunk_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, pool) as Row[];

    const seen = new Set<number>();
    const out: LibraryHit[] = [];
    for (const r of rows) {
      const bookId = Number(r.book_id);
      if (seen.has(bookId)) continue;
      seen.add(bookId);
      const book = db.prepare("SELECT title, authors FROM books WHERE book_id = ?").get(bookId) as Row;
      out.push({
        bookId,
        title: String(book?.title ?? `book ${bookId}`),
        authors: parseAuthors(book?.authors),
        score: Number(r.score), // bm25: negative, lower (more negative) is a better match
        snippet: String(r.body ?? "").slice(0, SNIPPET_CHARS),
        charStart: Number(r.char_start),
        charEnd: Number(r.char_end),
      });
      if (out.length >= k) break;
    }
    return out;
  }

  searchBookFts(libraryId: string, bookId: number, stemmedQuery: string, k: number): BookHit[] {
    const db = this.#db(libraryId);
    const match = ftsMatch(stemmedQuery);
    if (!match) return [];
    const rows = db
      .prepare(
        `SELECT c.id AS chunk_id, c.char_start, c.char_end, c.body, bm25(chunk_fts) AS score
         FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
         WHERE chunk_fts MATCH ? AND c.book_id = ? ORDER BY rank LIMIT ?`,
      )
      .all(match, bookId, k) as Row[];
    return rows.map((r) => ({
      chunkId: Number(r.chunk_id),
      charStart: Number(r.char_start),
      charEnd: Number(r.char_end),
      body: String(r.body ?? ""),
      score: Number(r.score),
    }));
  }

  stats(libraryId: string): { books: number; chunks: number } {
    const db = this.#db(libraryId);
    const books = db.prepare("SELECT COUNT(*) AS n FROM books").get() as Row;
    const chunks = db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as Row;
    return { books: Number(books?.n ?? 0), chunks: Number(chunks?.n ?? 0) };
  }

  close(): void {
    for (const db of this.#dbs.values()) db.close();
    this.#dbs.clear();
  }

  /** Load candidate vectors — all of a library, or one book (the doc's book-scope subarray). */
  #candidates(db: DatabaseSync, bookId?: number): Candidate[] {
    const rows =
      bookId === undefined
        ? (db.prepare("SELECT chunk_id, book_id, vector FROM embeddings").all() as Row[])
        : (db.prepare("SELECT chunk_id, book_id, vector FROM embeddings WHERE book_id = ?").all(
            bookId,
          ) as Row[]);
    return rows.map((r) => ({
      chunkId: Number(r.chunk_id),
      bookId: Number(r.book_id),
      vector: decodeVector(r.vector as Uint8Array),
    }));
  }

  /** Lazily open (and validate) the per-library db. */
  #db(libraryId: string): DatabaseSync {
    let db = this.#dbs.get(libraryId);
    if (db) return db;
    const file = this.#file(libraryId);
    if (file !== ":memory:") mkdirSync(this.cfg.indexDir, { recursive: true });
    db = new DatabaseSync(file);
    db.exec(SCHEMA);
    this.#ensureMeta(db);
    this.#dbs.set(libraryId, db);
    return db;
  }

  /** Write index metadata on a fresh db; refuse to use one built by a different model/version. */
  #ensureMeta(db: DatabaseSync): void {
    const existing = new Map<string, string>();
    for (const r of db.prepare("SELECT key, value FROM meta").all() as Row[]) {
      existing.set(String(r.key), String(r.value));
    }
    const want: Record<string, string> = {
      model_id: MODEL_ID,
      dim: String(EMBED_DIM),
      index_version: String(INDEX_VERSION),
    };
    if (existing.size === 0) {
      const ins = db.prepare("INSERT INTO meta(key, value) VALUES(?, ?)");
      for (const [k, v] of Object.entries(want)) ins.run(k, v);
      db.prepare("INSERT INTO meta(key, value) VALUES(?, ?)").run("created_at", new Date().toISOString());
      return;
    }
    for (const [k, v] of Object.entries(want)) {
      if (existing.get(k) !== v) {
        throw new Error(
          `INDEX_INCOMPATIBLE: index built with ${k}=${existing.get(k)} but this server uses ${v}. ` +
            `Delete the index and rebuild (calibre_build_index force=true).`,
        );
      }
    }
  }

  /** Db path for a library (no fs side effects). ":memory:" when the index dir is in-memory. */
  #file(libraryId: string): string {
    if (this.cfg.indexDir === ":memory:") return ":memory:";
    // Sanitize the library id into a safe filename component.
    const safe = libraryId.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
    return path.join(this.cfg.indexDir, `${safe}.sqlite`);
  }
}

/**
 * Build an FTS5 MATCH expression from an already-stemmed query. Tokens are OR-ed (recall-first;
 * RRF and the vector half restore precision) and phrase-quoted so punctuation/operators in a
 * token can't be parsed as FTS syntax. Returns null when the query has no searchable tokens.
 */
function ftsMatch(stemmed: string): string | null {
  const toks = stemmed.split(/\s+/).filter(Boolean);
  if (toks.length === 0) return null;
  return toks.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

/** authors are stored as a JSON array string; tolerate legacy/garbled values. */
function parseAuthors(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return raw ? [raw] : [];
  }
}
