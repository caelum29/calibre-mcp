// SQLite-backed vector index for semantic search. Uses node:sqlite (built into Node 22.5+),
// so the npx/MCPB bundle ships with ZERO native addons — no node-gyp, no ABI lock, no macOS
// quarantine on a prebuilt .node (the exact install failure the project avoids). Vectors are
// L2-normalized Float32 BLOBs; retrieval is in-memory brute-force cosine (== dot product) over
// a per-library candidate cache (decoded once, invalidated on write) — flat scan beats ANN at
// this scale; the cost worth killing was the per-query BLOB reload, not the scan.
//
// The store is keyed per Calibre library: each library gets its own <indexDir>/<lib>.sqlite,
// opened lazily so read-only sessions that never build an index create no files. The index db
// is PERSISTENT (survives reboots) — unlike the regenerable extract cache in tmp.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { log as defaultLog } from "../logging.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "./model.js";
import { stemText } from "./stem.js";
import { type Candidate, decodeVector, encodeVector, topK } from "./vector.js";

/** A chunk ready to index: its span in the source text plus its embedding. */
export interface IndexedChunk {
  charStart: number;
  charEnd: number;
  body: string;
  /** True when the chunk lies before the first detected chapter (TOC/praise/foreword). */
  frontMatter?: boolean;
  /** The chunk's embedding, or undefined for a keyword-only build (FTS-searchable, no vector). */
  vector?: Float32Array;
}

/**
 * A figure caption ready to index (D-018 Phase B / #86): the marker gives position
 * (charOffset in the SAME marker-injected text the chunks were cut from), the figure
 * inventory gives pixels metadata (source/dims). `vector` is the caption embedding;
 * absent on keyword-only builds (caption stays FTS-searchable).
 */
export interface IndexedFigure {
  /** FigureEntry.index — the handle calibre_get_figures fetches by. */
  figIndex: number;
  /** PDF: 1-based page. EPUB: spine-document ordinal. */
  page: number;
  caption: string;
  /** Marker offset in the marker-injected text — the figure↔chunk join key. */
  charOffset: number;
  /** Format the offsets/indexes refer to (pdf|epub) — figure indexes are per-format. */
  format: string;
  /** Pixel provenance; undefined when the inventory was unavailable at index time. */
  source?: "raster" | "page-render" | "svg-render";
  width?: number;
  height?: number;
  vector?: Float32Array;
}

/** A figure-caption search hit (target=figures): pointers + caption, never pixels. */
export interface FigureHit {
  /** figures rowid — the fusion key between the vector and keyword halves. */
  figureId: number;
  bookId: number;
  title: string;
  authors: string[];
  figIndex: number;
  page: number;
  caption: string;
  charOffset: number;
  format: string;
  source?: string;
  score: number;
}

/** The chunk a figure marker falls inside — the figure's surrounding context. */
export interface ChunkRef {
  chunkId: number;
  charStart: number;
  charEnd: number;
  body: string;
  frontMatter: boolean;
}

/** A figure linked from a text span (the text-hit → figures direction). */
export interface FigureRef {
  figIndex: number;
  page: number;
  caption: string;
  charOffset: number;
  format: string;
  source?: string;
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
  /** Full text of the best-matching chunk (snippet is display-truncated; rerankers need it all). */
  body: string;
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
  /** True for front-matter chunks (TOC/praise/foreword) — demoted below body in search. */
  frontMatter: boolean;
}

/** What a prune actually removed — reported by the build tool, never a silent cleanup (#100). */
export interface PruneCounts {
  books: number;
  chunks: number;
  figures: number;
}

export interface IndexStore {
  /** Cheap, side-effect-free check for an existing index (no db file is created). */
  hasIndex(libraryId: string): boolean;
  /** True if the index holds any embedding vectors (false = a keyword-only build). */
  hasVectors(libraryId: string): boolean;
  /** True if the book is indexed; when `lastModified` is given, also that it's up to date. */
  isBookIndexed(libraryId: string, bookId: number, lastModified?: string): boolean;
  /** Replace all of a book's chunks/embeddings/figures atomically (idempotent re-index). */
  replaceBook(libraryId: string, meta: BookMeta, chunks: IndexedChunk[], figures?: IndexedFigure[]): void;
  /** Every book id currently in the index (empty for an absent index) — the prune diff input. */
  indexedBookIds(libraryId: string): number[];
  /** Drop all rows for these books (books/chunks/embeddings/figures + FTS shadows). */
  deleteBooks(libraryId: string, bookIds: number[]): PruneCounts;
  /** Rank books by their single best-matching chunk (best chunk per book), vector cosine. */
  searchLibrary(libraryId: string, query: Float32Array, k: number): LibraryHit[];
  /** Rank passages within one book, vector cosine. */
  searchBook(libraryId: string, bookId: number, query: Float32Array, k: number): BookHit[];
  /** Keyword half: rank books by best weighted-bm25 FTS5 match (score is negative, lower is better). */
  searchLibraryFts(libraryId: string, stemmedQuery: string, k: number): LibraryHit[];
  /** Keyword half: rank passages within one book by weighted-bm25 FTS5 match. */
  searchBookFts(libraryId: string, bookId: number, stemmedQuery: string, k: number): BookHit[];
  /** Rank figure captions by vector cosine — the whole library, or one book. */
  searchFigures(libraryId: string, query: Float32Array, k: number, bookId?: number): FigureHit[];
  /** Keyword half over figure captions (weighted-bm25 FTS5). */
  searchFiguresFts(libraryId: string, stemmedQuery: string, k: number, bookId?: number): FigureHit[];
  /** Indexed-figure count (library or one book); 0 for an absent index. Cheap COUNT. */
  figureCount(libraryId: string, bookId?: number): number;
  /** The chunk containing a figure marker offset (figure → context direction). */
  chunkAt(libraryId: string, bookId: number, charOffset: number): ChunkRef | undefined;
  /** Figures whose marker falls inside a chunk span (text hit → figures direction). */
  figuresInSpan(libraryId: string, bookId: number, charStart: number, charEnd: number): FigureRef[];
  stats(libraryId: string): { books: number; chunks: number; figures: number };
  /** Number of stored embedding vectors (0 for a keyword-only or absent index). Cheap COUNT. */
  vectorCount(libraryId: string): number;
  close(): void;
}

/** Length of a result snippet (chars) taken from the best chunk. */
const SNIPPET_CHARS = 320;

// bm25() per-column weights, in chunk_fts column order (body_stem, body, book_meta).
// book_meta (the stemmed title+authors) lets a query naming a book surface it even when the
// title never recurs in prose, but it must never dominate body matches — hence 0.5. Tune these
// ONLY through the retrieval eval (test/eval/retrieval), never by feel.
const BM25_WEIGHT_BODY_STEM = 1.0;
const BM25_WEIGHT_BODY = 1.0;
const BM25_WEIGHT_BOOK_META = 0.5;
const WEIGHTED_BM25 = `bm25(chunk_fts, ${BM25_WEIGHT_BODY_STEM}, ${BM25_WEIGHT_BODY}, ${BM25_WEIGHT_BOOK_META})`;
// figure_fts mirrors the chunk weights: stemmed caption + raw caption 1.0, book identity 0.5.
const WEIGHTED_FIG_BM25 = `bm25(figure_fts, ${BM25_WEIGHT_BODY_STEM}, ${BM25_WEIGHT_BODY}, ${BM25_WEIGHT_BOOK_META})`;

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
  body_stem TEXT NOT NULL DEFAULT '',
  book_meta TEXT NOT NULL DEFAULT '',
  front_matter INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id);
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id),
  book_id INTEGER NOT NULL,
  vector BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emb_book ON embeddings(book_id);

-- Keyword half: FTS5 external-content index over chunks. body_stem holds EN+RU pre-stemmed
-- text (recall); body holds raw text (exact/identifier matches); book_meta holds the stemmed
-- title+authors of the chunk's book so a query naming a book matches its chunks (weighted low
-- via ${WEIGHTED_BM25} — it helps, never dominates prose). book_meta is per-book-constant
-- repeated per chunk — accepted FTS bloat; external-content tables can't join at trigger time,
-- and the column name must match chunks' (FTS5 resolves content-table columns BY NAME).
-- tokenchars keep code tokens (e.g. c++, __init__, api.v2) intact. Kept in sync with chunks
-- via the triggers below.
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  body_stem, body, book_meta,
  content='chunks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2 tokenchars ''-_+#.'''
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunk_fts(rowid, body_stem, body, book_meta) VALUES (new.id, new.body_stem, new.body, new.book_meta);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, body_stem, body, book_meta) VALUES('delete', old.id, old.body_stem, old.body, old.book_meta);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, body_stem, body, book_meta) VALUES('delete', old.id, old.body_stem, old.body, old.book_meta);
  INSERT INTO chunk_fts(rowid, body_stem, body, book_meta) VALUES (new.id, new.body_stem, new.body, new.book_meta);
END;

-- Figures (D-018 Phase B / #86): caption embeddings + the figure↔chunk join key.
-- char_offset indexes into the SAME marker-injected text the chunks were cut from, so
-- "the chunk containing this figure" is a pure range lookup — no extra bookkeeping.
-- Additive: CREATE IF NOT EXISTS runs on every open, so pre-figures dbs gain the empty
-- tables without an INDEX_VERSION bump (books fill them when re-indexed — the atomic
-- re-index is a separate step). vector is inline (nullable), not a side table: figure
-- counts are ~2 orders below chunk counts, the split isn't worth a join.
CREATE TABLE IF NOT EXISTS figures (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL,
  fig_index INTEGER NOT NULL,
  page INTEGER NOT NULL,
  caption TEXT NOT NULL,
  caption_stem TEXT NOT NULL DEFAULT '',
  book_meta TEXT NOT NULL DEFAULT '',
  char_offset INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT '',
  source TEXT,
  width INTEGER,
  height INTEGER,
  vector BLOB
);
CREATE INDEX IF NOT EXISTS idx_figures_book ON figures(book_id);
CREATE VIRTUAL TABLE IF NOT EXISTS figure_fts USING fts5(
  caption_stem, caption, book_meta,
  content='figures', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2 tokenchars ''-_+#.'''
);
CREATE TRIGGER IF NOT EXISTS figures_ai AFTER INSERT ON figures BEGIN
  INSERT INTO figure_fts(rowid, caption_stem, caption, book_meta) VALUES (new.id, new.caption_stem, new.caption, new.book_meta);
END;
CREATE TRIGGER IF NOT EXISTS figures_ad AFTER DELETE ON figures BEGIN
  INSERT INTO figure_fts(figure_fts, rowid, caption_stem, caption, book_meta) VALUES('delete', old.id, old.caption_stem, old.caption, old.book_meta);
END;
CREATE TRIGGER IF NOT EXISTS figures_au AFTER UPDATE ON figures BEGIN
  INSERT INTO figure_fts(figure_fts, rowid, caption_stem, caption, book_meta) VALUES('delete', old.id, old.caption_stem, old.caption, old.book_meta);
  INSERT INTO figure_fts(rowid, caption_stem, caption, book_meta) VALUES (new.id, new.caption_stem, new.caption, new.book_meta);
END;
`;

type Row = Record<string, unknown>;

/**
 * Decoded candidate vectors for one library, held in memory so vector queries don't
 * re-read/decode every embeddings BLOB from SQLite (seconds of I/O at full-library scale).
 * `byBook` holds references into the same Candidate objects as `all` — an index, not a copy.
 */
interface CandidateCache {
  all: Candidate[];
  byBook: Map<number, Candidate[]>;
}

export class SqliteIndexStore implements IndexStore {
  #dbs = new Map<string, DatabaseSync>();
  // Per-library candidate cache; invalidated wholesale on any write (correctness > cleverness).
  // DEFERRED: int8-quantize this in-memory copy (~99.8% recall at 4x smaller) once full-library indexing lands.
  #candidateCaches = new Map<string, CandidateCache>();
  // Figure-caption vectors, cached separately (Candidate.chunkId holds the figures rowid here).
  #figureCaches = new Map<string, CandidateCache>();

  constructor(
    private readonly cfg: Config,
    /** Injected stderr logger seam (tests/callers may substitute); defaults to the module logger. */
    private readonly log: typeof defaultLog = defaultLog,
  ) {}

  hasIndex(libraryId: string): boolean {
    if (this.#dbs.has(libraryId)) return true;
    if (this.cfg.indexDir === ":memory:") return false;
    return existsSync(this.#file(libraryId));
  }

  hasVectors(libraryId: string): boolean {
    if (!this.hasIndex(libraryId)) return false;
    const db = this.#db(libraryId);
    return db.prepare("SELECT 1 FROM embeddings LIMIT 1").get() !== undefined;
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

  replaceBook(libraryId: string, meta: BookMeta, chunks: IndexedChunk[], figures: IndexedFigure[] = []): void {
    const db = this.#db(libraryId);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM embeddings WHERE book_id = ?").run(meta.bookId);
      db.prepare("DELETE FROM chunks WHERE book_id = ?").run(meta.bookId);
      db.prepare("DELETE FROM figures WHERE book_id = ?").run(meta.bookId);
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
        "INSERT INTO chunks(book_id, char_start, char_end, body, body_stem, book_meta, front_matter) VALUES(?,?,?,?,?,?,?)",
      );
      const insEmb = db.prepare("INSERT INTO embeddings(chunk_id, book_id, vector) VALUES(?,?,?)");
      // Stemmed once per book (same transform as body_stem/queries) and repeated on every
      // chunk row, so the FTS half sees book identity — the vector half already gets it via
      // the embedded "[title › authors]" context prefix.
      const bookMeta = stemText(`${meta.title} ${meta.authors.join(" ")}`);
      for (const c of chunks) {
        // Pre-stem here so the FTS keyword half is populated by the insert trigger.
        const { lastInsertRowid } = insChunk.run(
          meta.bookId,
          c.charStart,
          c.charEnd,
          c.body,
          stemText(c.body),
          bookMeta,
          c.frontMatter ? 1 : 0,
        );
        // A keyword-only build has no vector — the chunk is still FTS-searchable via the
        // trigger above; we just skip the embeddings row (vector search naturally excludes it).
        if (c.vector) insEmb.run(Number(lastInsertRowid), meta.bookId, encodeVector(c.vector));
      }
      const insFig = db.prepare(
        "INSERT INTO figures(book_id, fig_index, page, caption, caption_stem, book_meta, char_offset, format, source, width, height, vector) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      );
      for (const f of figures) {
        insFig.run(
          meta.bookId,
          f.figIndex,
          f.page,
          f.caption,
          stemText(f.caption),
          bookMeta,
          f.charOffset,
          f.format,
          f.source ?? null,
          f.width ?? null,
          f.height ?? null,
          f.vector ? encodeVector(f.vector) : null,
        );
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    } finally {
      // Any write (even a rolled-back one — a needless rebuild is harmless) drops the
      // library's candidate caches; the next vector query rebuilds them from SQLite.
      this.#candidateCaches.delete(libraryId);
      this.#figureCaches.delete(libraryId);
    }
  }

  indexedBookIds(libraryId: string): number[] {
    if (!this.hasIndex(libraryId)) return [];
    const rows = this.#db(libraryId).prepare("SELECT book_id FROM books").all() as Row[];
    return rows.map((r) => Number(r.book_id));
  }

  deleteBooks(libraryId: string, bookIds: number[]): PruneCounts {
    const counts: PruneCounts = { books: 0, chunks: 0, figures: 0 };
    if (bookIds.length === 0 || !this.hasIndex(libraryId)) return counts;
    const db = this.#db(libraryId);
    db.exec("BEGIN");
    try {
      const delEmb = db.prepare("DELETE FROM embeddings WHERE book_id = ?");
      const delChunks = db.prepare("DELETE FROM chunks WHERE book_id = ?");
      const delFigures = db.prepare("DELETE FROM figures WHERE book_id = ?");
      const delBook = db.prepare("DELETE FROM books WHERE book_id = ?");
      for (const id of bookIds) {
        delEmb.run(id);
        // The chunks/figures DELETE triggers keep the FTS shadow tables in sync.
        counts.chunks += Number(delChunks.run(id).changes);
        counts.figures += Number(delFigures.run(id).changes);
        counts.books += Number(delBook.run(id).changes);
      }
      db.exec("COMMIT");
      return counts;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    } finally {
      this.#candidateCaches.delete(libraryId);
      this.#figureCaches.delete(libraryId);
    }
  }

  searchLibrary(libraryId: string, query: Float32Array, k: number): LibraryHit[] {
    const db = this.#db(libraryId);
    const hits = topK(query, this.#candidates(libraryId), Number.MAX_SAFE_INTEGER);

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
    const db = this.#db(libraryId);
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

  searchLibraryFts(libraryId: string, stemmedQuery: string, k: number): LibraryHit[] {
    const db = this.#db(libraryId);
    const match = ftsMatch(stemmedQuery);
    if (!match) return [];
    // Pull a generous pool of chunk hits, then keep the best (first, since bm25-ranked) per book.
    const pool = Math.max(k * 20, 200);
    const rows = db
      .prepare(
        `SELECT c.id AS chunk_id, c.book_id, c.char_start, c.char_end, c.body, ${WEIGHTED_BM25} AS score
         FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
         WHERE chunk_fts MATCH ? ORDER BY score LIMIT ?`,
      )
      .all(match, pool) as Row[];

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
    const db = this.#db(libraryId);
    const match = ftsMatch(stemmedQuery);
    if (!match) return [];
    const rows = db
      .prepare(
        `SELECT c.id AS chunk_id, c.char_start, c.char_end, c.body, c.front_matter, ${WEIGHTED_BM25} AS score
         FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
         WHERE chunk_fts MATCH ? AND c.book_id = ? ORDER BY score LIMIT ?`,
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

  searchFigures(libraryId: string, query: Float32Array, k: number, bookId?: number): FigureHit[] {
    const db = this.#db(libraryId);
    const hits = topK(query, this.#figureCandidates(libraryId, bookId), k);
    return hits
      .map((h) => this.#figureHit(db, h.chunkId, h.score))
      .filter((h): h is FigureHit => h !== undefined);
  }

  searchFiguresFts(libraryId: string, stemmedQuery: string, k: number, bookId?: number): FigureHit[] {
    const db = this.#db(libraryId);
    const match = ftsMatch(stemmedQuery);
    if (!match) return [];
    const rows =
      bookId === undefined
        ? (db
            .prepare(
              `SELECT f.id AS fig_id, ${WEIGHTED_FIG_BM25} AS score
               FROM figure_fts JOIN figures f ON f.id = figure_fts.rowid
               WHERE figure_fts MATCH ? ORDER BY score LIMIT ?`,
            )
            .all(match, k) as Row[])
        : (db
            .prepare(
              `SELECT f.id AS fig_id, ${WEIGHTED_FIG_BM25} AS score
               FROM figure_fts JOIN figures f ON f.id = figure_fts.rowid
               WHERE figure_fts MATCH ? AND f.book_id = ? ORDER BY score LIMIT ?`,
            )
            .all(match, bookId, k) as Row[]);
    return rows
      .map((r) => this.#figureHit(db, Number(r.fig_id), Number(r.score)))
      .filter((h): h is FigureHit => h !== undefined);
  }

  figureCount(libraryId: string, bookId?: number): number {
    // Same no-side-effect guard as vectorCount: a read must never create a db file.
    if (!this.hasIndex(libraryId)) return 0;
    const db = this.#db(libraryId);
    const row =
      bookId === undefined
        ? (db.prepare("SELECT COUNT(*) AS n FROM figures").get() as Row)
        : (db.prepare("SELECT COUNT(*) AS n FROM figures WHERE book_id = ?").get(bookId) as Row);
    return Number(row?.n ?? 0);
  }

  chunkAt(libraryId: string, bookId: number, charOffset: number): ChunkRef | undefined {
    const db = this.#db(libraryId);
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

  figuresInSpan(libraryId: string, bookId: number, charStart: number, charEnd: number): FigureRef[] {
    const db = this.#db(libraryId);
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

  stats(libraryId: string): { books: number; chunks: number; figures: number } {
    const db = this.#db(libraryId);
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
    if (!this.hasIndex(libraryId)) return 0;
    const row = this.#db(libraryId).prepare("SELECT COUNT(*) AS n FROM embeddings").get() as Row;
    return Number(row?.n ?? 0);
  }

  close(): void {
    for (const db of this.#dbs.values()) db.close();
    this.#dbs.clear();
    this.#candidateCaches.clear();
    this.#figureCaches.clear();
  }

  /** Materialize one figures row (+ its book identity) into a FigureHit. */
  #figureHit(db: DatabaseSync, figRowId: number, score: number): FigureHit | undefined {
    const r = db
      .prepare(
        "SELECT book_id, fig_index, page, caption, char_offset, format, source FROM figures WHERE id = ?",
      )
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
  #figureCandidates(libraryId: string, bookId?: number): Candidate[] {
    let cache = this.#figureCaches.get(libraryId);
    if (!cache) {
      const rows = this.#db(libraryId)
        .prepare("SELECT id, book_id, vector FROM figures WHERE vector IS NOT NULL")
        .all() as Row[];
      const all = rows.map((r) => ({
        chunkId: Number(r.id), // Candidate.chunkId doubles as the figures rowid here
        bookId: Number(r.book_id),
        vector: decodeVector(r.vector as Uint8Array),
      }));
      const byBook = new Map<number, Candidate[]>();
      for (const c of all) {
        const list = byBook.get(c.bookId);
        if (list) list.push(c);
        else byBook.set(c.bookId, [c]);
      }
      cache = { all, byBook };
      this.#figureCaches.set(libraryId, cache);
    }
    return bookId === undefined ? cache.all : (cache.byBook.get(bookId) ?? []);
  }

  /**
   * Read + decode ALL embedding BLOBs of a library from SQLite — the expensive path the
   * candidate cache exists to avoid. `decodeVector` copies each BLOB into a fresh
   * Float32Array, so cached vectors never alias sqlite's pooled buffers.
   * @internal public only as a spy seam for the cache tests; not part of `IndexStore`.
   */
  loadCandidates(libraryId: string): Candidate[] {
    const rows = this.#db(libraryId)
      .prepare("SELECT chunk_id, book_id, vector FROM embeddings")
      .all() as Row[];
    return rows.map((r) => ({
      chunkId: Number(r.chunk_id),
      bookId: Number(r.book_id),
      vector: decodeVector(r.vector as Uint8Array),
    }));
  }

  /** Candidate vectors — all of a library, or one book (the doc's book-scope subarray). */
  #candidates(libraryId: string, bookId?: number): Candidate[] {
    let cache = this.#candidateCaches.get(libraryId);
    if (!cache) {
      const all = this.loadCandidates(libraryId);
      const byBook = new Map<number, Candidate[]>();
      for (const c of all) {
        const list = byBook.get(c.bookId);
        if (list) list.push(c);
        else byBook.set(c.bookId, [c]);
      }
      cache = { all, byBook };
      this.#candidateCaches.set(libraryId, cache);
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

  /** Lazily open (and validate) the per-library db. */
  #db(libraryId: string): DatabaseSync {
    let db = this.#dbs.get(libraryId);
    if (db) return db;
    const file = this.#file(libraryId);
    if (file !== ":memory:") mkdirSync(this.cfg.indexDir, { recursive: true });
    db = new DatabaseSync(file);
    db.exec(SCHEMA);
    this.#migrate(db);
    this.#ensureMeta(db);
    this.#dbs.set(libraryId, db);
    return db;
  }

  /**
   * Additive, idempotent migrations for dbs created before a column existed. Deliberately NOT
   * an INDEX_VERSION bump: DEFAULT 0 = pre-flag behavior, so a full-library rebuild isn't
   * forced — books pick the flag up when re-indexed.
   */
  #migrate(db: DatabaseSync): void {
    const cols = db.prepare("PRAGMA table_info(chunks)").all() as Row[];
    if (!cols.some((c) => c.name === "front_matter")) {
      db.exec("ALTER TABLE chunks ADD COLUMN front_matter INTEGER NOT NULL DEFAULT 0");
      this.log.info("index migrated: chunks.front_matter added");
    }
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
