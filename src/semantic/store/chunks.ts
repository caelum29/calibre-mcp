// Chunk retrieval (#272): the vector half (brute-force cosine over a per-library packed vector
// matrix, decoded once, refreshed per changed book on any write — #370, #618) and the keyword half
// (weighted bm25 over chunk_fts, its MATCH planned from the library's term statistics, #651), plus
// figure → context lookup. Snippet windows: ../snippet.ts.

import type { DatabaseSync } from "node:sqlite";
import type { LogSink } from "../../logging.js";
import { EMBED_DIM } from "../model.js";
import { SNIPPET_CHARS } from "../snippet.js";
import type { KeywordDrop, TermStats } from "../../domain/search/keyword-plan.js";
import { toMatterKind } from "../../domain/structure/matter-kind.js";
import { decodeVector } from "../vector.js";
import {
  bookTop,
  type ChunkMatrix,
  libraryTop,
  matterCode,
  MatrixWriter,
  matrixRows,
  mergeMatrix,
  withBodyQuota,
} from "./chunk-matrix.js";
import type { IndexConnections } from "./schema.js";
import {
  type CacheVersion,
  cacheFreshness,
  keywordMatch,
  markDirty,
  parseAuthors,
  rollbackQuietly,
  type Row,
  WEIGHTED_BM25,
} from "./shared.js";
import { fts5TermStats } from "./term-stats.js";
import type { BookHit, ChunkIndex, ChunkRef, KeywordPlanReport, LibraryHit } from "./types.js";

/** One library's packed chunk vectors plus the version it was read under. */
interface ChunkCache extends CacheVersion {
  matrix: ChunkMatrix;
}

/** ChunkIndex over the shared connections with its own per-library vector matrix. */
export class SqliteChunkIndex implements ChunkIndex, KeywordPlanReport {
  // Per-library packed matrix; an own write or another connection's commit (data_version)
  // reloads only the books whose `books` row changed (#370), copying the rest (#618).
  // DEFERRED: quantising this in-memory copy is #653.
  #caches = new Map<string, ChunkCache>();
  // #651: per library, term statistics bound to the connection they were built on (null =
  // unavailable there). Dropped with the candidate cache: own writes never move data_version.
  #stats = new Map<string, { db: DatabaseSync; stats: TermStats | null }>();

  constructor(
    private readonly conn: IndexConnections,
    private readonly log: LogSink,
    /** Reads + decodes a library's embedding BLOBs; injectable so the store keeps its spy seam. */
    private readonly load: (libraryId: string) => ChunkMatrix = (l) => loadChunkMatrix(conn.db(l)),
  ) {}

  /** Mark books this connection just wrote; the next read reloads exactly them. */
  invalidate(libraryId: string, bookIds: readonly number[]): void {
    markDirty(this.#caches, libraryId, bookIds);
    this.#stats.delete(libraryId);
  }

  /** Drop every cache (store close). */
  clear(): void {
    this.#caches.clear();
    this.#stats.clear();
  }

  keywordDropped(libraryId: string, query: string): KeywordDrop[] | undefined {
    const db = this.conn.db(libraryId);
    return keywordMatch(query, this.#termStats(libraryId, db)).dropped;
  }

  /** The library's term statistics on `db`, built once per connection; undefined when fts5vocab fails there. */
  #termStats(libraryId: string, db: DatabaseSync): TermStats | undefined {
    const held = this.#stats.get(libraryId);
    if (held?.db === db) return held.stats ?? undefined;
    let stats: TermStats | null = null;
    try {
      stats = fts5TermStats(db);
    } catch (err) {
      // the keyword half still answers with today's MATCH; only pruning and dedupe are lost
      this.log.warn("keyword plan unavailable: no term statistics, MATCH built as before", {
        libraryId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.#stats.set(libraryId, { db, stats });
    return stats ?? undefined;
  }

  searchLibrary(libraryId: string, query: Float32Array, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    const db = this.conn.db(libraryId);
    // One pass keeping the best chunk per book, books ranked by it, up to k (#618).
    const out: LibraryHit[] = [];
    for (const { bookId, ...best } of libraryTop(this.#matrix(libraryId), query, k, allow)) {
      const book = db.prepare("SELECT title, authors FROM books WHERE book_id = ?").get(bookId) as Row;
      const chunk = db
        .prepare("SELECT char_start, char_end, body, matter_kind FROM chunks WHERE id = ?")
        .get(best.chunkId) as Row;
      const body = String(chunk?.body ?? "");
      out.push({
        bookId,
        chunkId: best.chunkId,
        title: String(book?.title ?? `book ${bookId}`),
        authors: parseAuthors(book?.authors),
        score: best.score,
        snippet: body.slice(0, SNIPPET_CHARS),
        body,
        charStart: Number(chunk?.char_start ?? 0),
        charEnd: Number(chunk?.char_end ?? 0),
        matterKind: toMatterKind(chunk?.matter_kind),
      });
    }
    return out; // already ordered: libraryTop ranks books best-first
  }

  searchBook(libraryId: string, bookId: number, query: Float32Array, k: number): BookHit[] {
    const db = this.conn.db(libraryId);
    const hits = bookTop(this.#matrix(libraryId), bookId, query, k);
    return hits.map((h) => {
      const chunk = db
        .prepare("SELECT char_start, char_end, body, front_matter, matter_kind FROM chunks WHERE id = ?")
        .get(h.chunkId) as Row;
      return {
        chunkId: h.chunkId,
        charStart: Number(chunk?.char_start ?? 0),
        charEnd: Number(chunk?.char_end ?? 0),
        body: String(chunk?.body ?? ""),
        score: h.score,
        frontMatter: Number(chunk?.front_matter ?? 0) === 1,
        matterKind: toMatterKind(chunk?.matter_kind),
      };
    });
  }

  searchLibraryFts(libraryId: string, query: string, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    const db = this.conn.db(libraryId);
    const { match } = keywordMatch(query, this.#termStats(libraryId, db));
    if (!match) return [];
    // Pull a generous pool of chunk hits, then keep the best (first, since bm25-ranked) per book.
    // Equal bm25 orders by book id, then chunk id (#392): SQLite's scan order is no contract.
    // Known limit (#694): the pool counts chunks, not books, and non-body chunks take slots too
    // (#605). A query whose top `pool` rows are all index pages loses the body books beyond them.
    const pool = Math.max(k * 20, 200);
    // The allow filter lives in SQL (json_each keeps it to one variable) so a small bundle
    // can't be starved by the pool cap eating unfiltered hits first. It uses the same FTS-first
    // CTE as searchBookFts: ~9 s → <0.8 s on stop-word-heavy queries, neutral otherwise. The
    // unfiltered branch keeps the plain JOIN — the CTE measured no gain there.
    const rows = (
      allow === undefined
        ? db
            .prepare(
              `SELECT c.id AS chunk_id, c.book_id, c.char_start, c.char_end, c.body, c.matter_kind, ${WEIGHTED_BM25} AS score
               FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
               WHERE chunk_fts MATCH ? ORDER BY score, c.book_id, c.id LIMIT ?`,
            )
            .all(match, pool)
        : db
            .prepare(
              `WITH m AS MATERIALIZED (
                 SELECT rowid AS id, ${WEIGHTED_BM25} AS s FROM chunk_fts WHERE chunk_fts MATCH ?
               )
               SELECT c.id AS chunk_id, c.book_id, c.char_start, c.char_end, c.body, c.matter_kind, m.s AS score
               FROM m JOIN chunks c ON c.id = m.id
               WHERE c.book_id IN (SELECT value FROM json_each(?))
               ORDER BY m.s, c.book_id, c.id LIMIT ?`,
            )
            .all(match, JSON.stringify([...allow]), pool)
    ) as Row[];

    // A book's representative is its first (best) body row in the pool; only a book with no body
    // row there falls back to its first non-body row (#605). Rows arrive in (score, book, chunk)
    // order, so sorting the representatives the same way equals today's first-row-per-book walk
    // when every row is body.
    const body = new Map<number, Row>();
    const other = new Map<number, Row>();
    for (const r of rows) {
      const bookId = Number(r.book_id);
      if (toMatterKind(r.matter_kind) === "body") {
        if (!body.has(bookId)) body.set(bookId, r);
      } else if (!other.has(bookId)) other.set(bookId, r);
    }
    const reps = [...body.values(), ...[...other].filter(([id]) => !body.has(id)).map(([, r]) => r)];
    reps.sort(
      (x, y) =>
        Number(x.score) - Number(y.score) ||
        Number(x.book_id) - Number(y.book_id) ||
        Number(x.chunk_id) - Number(y.chunk_id),
    );
    // k body books, fallbacks ranked among them kept (#605); k < 1 still yields one book, as the
    // first-row walk did (it checked the count after adding)
    return withBodyQuota(reps, (r) => body.has(Number(r.book_id)), Math.max(1, k)).map((r) => {
      const bookId = Number(r.book_id);
      const book = db.prepare("SELECT title, authors FROM books WHERE book_id = ?").get(bookId) as Row;
      const text = String(r.body ?? "");
      return {
        bookId,
        chunkId: Number(r.chunk_id),
        title: String(book?.title ?? `book ${bookId}`),
        authors: parseAuthors(book?.authors),
        score: Number(r.score), // bm25: negative, lower (more negative) is a better match
        snippet: text.slice(0, SNIPPET_CHARS),
        body: text,
        charStart: Number(r.char_start),
        charEnd: Number(r.char_end),
        matterKind: toMatterKind(r.matter_kind),
      };
    });
  }

  searchBookFts(libraryId: string, bookId: number, query: string, k: number): BookHit[] {
    const db = this.conn.db(libraryId);
    // the book's MATCH runs over the whole library's chunk_fts (FTS-first CTE), so the library's
    // shares are the ones that price its posting lists
    const { match } = keywordMatch(query, this.#termStats(libraryId, db));
    if (!match) return [];
    // FTS-first: with a plain JOIN the planner drives from idx_chunks_book and re-runs the
    // OR-ed MATCH per chunk (1.7–250 s on a 313k-chunk index); a MATERIALIZED CTE evaluates
    // MATCH once, then filters by book. Same rows, same bm25 scores.
    const rows = db
      .prepare(
        `WITH m AS MATERIALIZED (
           SELECT rowid AS id, ${WEIGHTED_BM25} AS s FROM chunk_fts WHERE chunk_fts MATCH ?
         )
         SELECT c.id AS chunk_id, c.char_start, c.char_end, c.body, c.front_matter, c.matter_kind, m.s AS score
         FROM m JOIN chunks c ON c.id = m.id
         WHERE c.book_id = ? ORDER BY m.s, c.id LIMIT ?`,
      )
      .all(match, bookId, k) as Row[];
    return rows.map((r) => ({
      chunkId: Number(r.chunk_id),
      charStart: Number(r.char_start),
      charEnd: Number(r.char_end),
      body: String(r.body ?? ""),
      score: Number(r.score),
      frontMatter: Number(r.front_matter ?? 0) === 1,
      matterKind: toMatterKind(r.matter_kind),
    }));
  }

  chunkAt(libraryId: string, bookId: number, charOffset: number): ChunkRef | undefined {
    const db = this.conn.db(libraryId);
    // Half-open [start, end): D-018 says "BETWEEN charStart AND charEnd", but inclusive ends
    // would match TWO chunks when a marker sits exactly on a boundary — the marker's text
    // begins at the boundary, so the LATER chunk (start == offset) is the one containing it.
    const row = db
      .prepare(
        `SELECT id, char_start, char_end, body, front_matter, matter_kind FROM chunks
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
      matterKind: toMatterKind(row.matter_kind),
    };
  }

  /** The library's packed vectors, current as of this call: cold load, hit, or per-book refresh. */
  #matrix(libraryId: string): ChunkMatrix {
    const db = this.conn.db(libraryId);
    const old = this.#caches.get(libraryId);
    const fresh = cacheFreshness(db, old);
    if (fresh.kind === "hit") return old!.matrix;
    // Refresh copies unchanged books' rows from the old matrix and decodes only the stale ones;
    // for that moment both matrices are resident.
    const matrix =
      fresh.kind === "cold"
        ? this.load(libraryId)
        : mergeMatrix(old!.matrix, fresh.stale, loadChunkMatrix(db, fresh.reload));
    this.#caches.set(libraryId, { matrix, dataVersion: fresh.dataVersion, stamps: fresh.stamps, dirty: new Set() });
    if (fresh.kind === "cold") {
      // Memory honesty: vectors dominate (EMBED_DIM float32 each); ids and the book table are noise.
      const rows = matrixRows(matrix);
      const mib = (rows * EMBED_DIM * 4) / (1024 * 1024);
      this.log.info("semantic candidate cache built", {
        library: libraryId,
        chunks: rows,
        approxMiB: Number(mib.toFixed(1)),
      });
    }
    return matrix;
  }
}

/**
 * Read + decode the embedding BLOBs of a library (or of `bookIds` only) from SQLite into a packed
 * matrix — the expensive path the cache exists to avoid. Per-book counts come first, so the
 * matrix is allocated once at its exact size; then one scan in chunk-id order (the table's own
 * order, no sort) places each row in its book's range. Both reads share one read transaction, so
 * another process's commit can't slip in between. `decodeVector` runs once per BLOB.
 */
export function loadChunkMatrix(db: DatabaseSync, bookIds?: readonly number[]): ChunkMatrix {
  const filter = bookIds === undefined ? "" : "WHERE book_id IN (SELECT value FROM json_each(?))";
  const params = bookIds === undefined ? [] : [JSON.stringify(bookIds)];
  if (bookIds?.length === 0) return new MatrixWriter(new Map()).finish();
  const own = !db.isTransaction; // a caller's transaction already pins the snapshot
  if (own) db.exec("BEGIN");
  try {
    const counts = new Map<number, number>();
    for (const r of db
      .prepare(`SELECT book_id, COUNT(*) AS n FROM embeddings ${filter} GROUP BY book_id`)
      .all(...params) as Row[]) {
      counts.set(Number(r.book_id), Number(r.n));
    }
    // Non-body rows are the few (#605): read their kinds once instead of joining every row.
    const kinds = new Map<number, number>();
    const kindFilter = bookIds === undefined ? "" : "AND book_id IN (SELECT value FROM json_each(?))";
    for (const r of db
      .prepare(`SELECT id, matter_kind FROM chunks WHERE matter_kind != 'body' ${kindFilter}`)
      .all(...params) as Row[]) {
      kinds.set(Number(r.id), matterCode(toMatterKind(r.matter_kind)));
    }
    const w = new MatrixWriter(counts);
    for (const r of db
      .prepare(`SELECT chunk_id, book_id, vector FROM embeddings ${filter} ORDER BY chunk_id`)
      .iterate(...params) as Iterable<Row>) {
      const chunkId = Number(r.chunk_id);
      w.place(Number(r.book_id), chunkId, decodeVector(r.vector as Uint8Array), kinds.get(chunkId) ?? 0);
    }
    const m = w.finish();
    if (own) db.exec("COMMIT");
    return m;
  } catch (err) {
    if (own) rollbackQuietly(db);
    throw err;
  }
}
