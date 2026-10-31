// SQLite-backed vector index for semantic search. Uses node:sqlite (built in; unflagged and
// shipping FTS5 from Node 22.16 — 22.5–22.12 need --experimental-sqlite, 22.13–22.15 lack FTS5),
// so the npx/MCPB bundle ships with ZERO native addons — no node-gyp, no ABI lock, no macOS
// quarantine on a prebuilt .node (the exact install failure the project avoids). Vectors are
// L2-normalized Float32 BLOBs; retrieval is in-memory brute-force cosine (== dot product) over
// a per-library candidate cache (decoded once, invalidated on write) — flat scan beats ANN at
// this scale; the cost worth killing was the per-query BLOB reload, not the scan.
//
// The store is keyed per Calibre library: each library gets its own <indexDir>/<lib>.sqlite,
// opened lazily so read-only sessions that never build an index create no files. The index db
// is PERSISTENT (survives reboots) — unlike the regenerable extract cache in tmp.
//
// Split by concern (#272): schema.ts owns the connections + DDL, freshness/writer/chunks/
// figures each implement one narrow port; this module composes them into the full IndexStore.

import type { Config } from "../../config.js";
import { log as defaultLog, type LogSink } from "../../logging.js";
import type { ChunkSpan } from "../content-match.js";
import type { Candidate } from "../vector.js";
import { loadChunkCandidates, SqliteChunkIndex } from "./chunks.js";
import { SqliteFigureIndex } from "./figures.js";
import { SqliteFreshness } from "./freshness.js";
import { IndexConnections } from "./schema.js";
import type {
  BookHit,
  BookMeta,
  ChunkRef,
  FigureHit,
  FigureRef,
  IndexedChunk,
  IndexedFigure,
  IndexMeta,
  IndexStore,
  LibraryHit,
  PruneCounts,
  RefreshCheck,
  ReplaceOutcome,
} from "./types.js";
import { SqliteWriter } from "./writer.js";

export type * from "./types.js";

/** node:sqlite-backed vector + FTS5 index store with a per-library in-memory candidate cache. */
export class SqliteIndexStore implements IndexStore {
  readonly #conn: IndexConnections;
  readonly #freshness: SqliteFreshness;
  readonly #writer: SqliteWriter;
  readonly #chunks: SqliteChunkIndex;
  readonly #figures: SqliteFigureIndex;

  constructor(
    cfg: Config,
    /** Injected stderr logger seam (tests/callers may substitute); defaults to the module logger. */
    log: LogSink = defaultLog,
  ) {
    this.#conn = new IndexConnections(cfg, log);
    this.#freshness = new SqliteFreshness(this.#conn);
    // Resolved per call, so a spy on this.loadCandidates sees the cache's SQL reads.
    this.#chunks = new SqliteChunkIndex(this.#conn, log, (l) => this.loadCandidates(l));
    this.#figures = new SqliteFigureIndex(this.#conn);
    // Any write (even a rolled-back one — a needless rebuild is harmless) drops the
    // library's candidate caches; the next vector query rebuilds them from SQLite.
    this.#writer = new SqliteWriter(this.#conn, (l) => {
      this.#chunks.invalidate(l);
      this.#figures.invalidate(l);
    });
  }

  hasIndex(libraryId: string): boolean {
    return this.#freshness.hasIndex(libraryId);
  }

  indexMeta(libraryId: string): IndexMeta | undefined {
    return this.#freshness.indexMeta(libraryId);
  }

  hasVectors(libraryId: string): boolean {
    return this.#freshness.hasVectors(libraryId);
  }

  isBookIndexed(
    libraryId: string,
    bookId: number,
    lastModified?: string,
    opts?: { requireVectors?: boolean },
  ): boolean {
    return this.#freshness.isBookIndexed(libraryId, bookId, lastModified, opts);
  }

  bookChunkSpans(libraryId: string, bookId: number): ChunkSpan[] {
    return this.#freshness.bookChunkSpans(libraryId, bookId);
  }

  bookVectorCount(libraryId: string, bookId: number): number {
    return this.#freshness.bookVectorCount(libraryId, bookId);
  }

  booksMissingVectors(libraryId: string): number {
    return this.#freshness.booksMissingVectors(libraryId);
  }

  indexedBookIds(libraryId: string): number[] {
    return this.#freshness.indexedBookIds(libraryId);
  }

  stats(libraryId: string): { books: number; chunks: number; figures: number } {
    return this.#freshness.stats(libraryId);
  }

  vectorCount(libraryId: string): number {
    return this.#freshness.vectorCount(libraryId);
  }

  replaceBook(
    libraryId: string,
    meta: BookMeta,
    chunks: IndexedChunk[],
    figures?: IndexedFigure[],
    opts?: { preserveEmbedded?: boolean },
  ): ReplaceOutcome {
    return this.#writer.replaceBook(libraryId, meta, chunks, figures, opts);
  }

  refreshBookMeta(libraryId: string, meta: BookMeta, check: RefreshCheck): boolean {
    return this.#writer.refreshBookMeta(libraryId, meta, check);
  }

  deleteBooks(libraryId: string, bookIds: number[]): PruneCounts {
    return this.#writer.deleteBooks(libraryId, bookIds);
  }

  searchLibrary(libraryId: string, query: Float32Array, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    return this.#chunks.searchLibrary(libraryId, query, k, allow);
  }

  searchBook(libraryId: string, bookId: number, query: Float32Array, k: number): BookHit[] {
    return this.#chunks.searchBook(libraryId, bookId, query, k);
  }

  searchLibraryFts(libraryId: string, stemmedQuery: string, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    return this.#chunks.searchLibraryFts(libraryId, stemmedQuery, k, allow);
  }

  searchBookFts(libraryId: string, bookId: number, stemmedQuery: string, k: number): BookHit[] {
    return this.#chunks.searchBookFts(libraryId, bookId, stemmedQuery, k);
  }

  chunkAt(libraryId: string, bookId: number, charOffset: number): ChunkRef | undefined {
    return this.#chunks.chunkAt(libraryId, bookId, charOffset);
  }

  searchFigures(
    libraryId: string,
    query: Float32Array,
    k: number,
    bookId?: number,
    allow?: ReadonlySet<number>,
  ): FigureHit[] {
    return this.#figures.searchFigures(libraryId, query, k, bookId, allow);
  }

  searchFiguresFts(
    libraryId: string,
    stemmedQuery: string,
    k: number,
    bookId?: number,
    allow?: ReadonlySet<number>,
  ): FigureHit[] {
    return this.#figures.searchFiguresFts(libraryId, stemmedQuery, k, bookId, allow);
  }

  figureCount(libraryId: string, bookId?: number): number {
    return this.#figures.figureCount(libraryId, bookId);
  }

  figuresInSpan(libraryId: string, bookId: number, charStart: number, charEnd: number): FigureRef[] {
    return this.#figures.figuresInSpan(libraryId, bookId, charStart, charEnd);
  }

  close(): void {
    this.#conn.close();
    this.#chunks.clear();
    this.#figures.clear();
  }

  /**
   * Read + decode ALL embedding BLOBs of a library — the path the candidate cache avoids.
   * @internal public only as a spy seam for the cache tests; not part of `IndexStore`.
   */
  loadCandidates(libraryId: string): Candidate[] {
    return loadChunkCandidates(this.#conn.db(libraryId));
  }
}
