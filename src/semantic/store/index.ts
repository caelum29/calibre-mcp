// SQLite-backed vector index for semantic search: one <indexDir>/<lib>.sqlite per Calibre library.
// Composes the schema/freshness/writer/chunks/figures/sections parts (#272) into the full IndexStore.

import type { Config } from "../../config.js";
import { log as defaultLog, type LogSink } from "../../logging.js";
import type { ChunkSpan } from "../content-match.js";
import { searchBookMetadata } from "./book-metadata.js";
import type { ChunkMatrix } from "./chunk-matrix.js";
import { loadChunkMatrix, SqliteChunkIndex } from "./chunks.js";
import { SqliteFigureIndex } from "./figures.js";
import { SqliteFreshness } from "./freshness.js";
import { SqliteSectionIndex } from "./sections.js";
import { IndexConnections } from "./schema.js";
import { IndexFileOwners } from "./library-owner.js";
import type { LibraryIdCollisionError } from "../../domain/library-id-collision.js";
import type { KeywordDrop } from "../../domain/search/keyword-plan.js";
import type { BookSections } from "../../domain/structure/sections.js";
import type {
  BookHit,
  BookMeta,
  ChunkRef,
  FigureHit,
  FigureRef,
  IndexedBookMetadata,
  IndexedChunk,
  IndexedFigure,
  IndexMeta,
  IndexStore,
  LibraryHit,
  PruneCounts,
  RefreshCheck,
  ReplaceOutcome,
  SectionRef,
} from "./types.js";
import { SqliteWriter } from "./writer.js";

export type * from "./types.js";

/**
 * node:sqlite-backed vector + FTS5 index store with a per-library in-memory candidate cache.
 *
 * Why node:sqlite: built in (unflagged and shipping FTS5 from Node 22.16 — 22.5–22.12 need
 * --experimental-sqlite, 22.13–22.15 lack FTS5), so the npx/MCPB bundle ships with ZERO native
 * addons — no node-gyp, no ABI lock, no macOS quarantine on a prebuilt .node (the exact install failure the project avoids). Vectors are
 * L2-normalized Float32 BLOBs; retrieval is in-memory brute-force cosine (== dot product) over a
 * per-library candidate cache (decoded once, refreshed per changed book) — flat scan beats ANN at this
 * scale; the cost worth killing was the per-query BLOB reload, not the scan.
 *
 * Each library gets its own db file, opened lazily so read-only sessions that never build an
 * index create no files. The db is PERSISTENT (survives reboots), unlike the regenerable
 * extract cache in tmp.
 */
export class SqliteIndexStore implements IndexStore {
  readonly #guard: IndexFileOwners;
  readonly #conn: IndexConnections;
  readonly #freshness: SqliteFreshness;
  readonly #writer: SqliteWriter;
  readonly #chunks: SqliteChunkIndex;
  readonly #figures: SqliteFigureIndex;
  readonly #sections: SqliteSectionIndex;

  constructor(
    cfg: Config,
    /** Injected stderr logger seam (tests/callers may substitute); defaults to the module logger. */
    log: LogSink = defaultLog,
  ) {
    // Split by concern (#272): schema.ts owns the connections + DDL; freshness/writer/chunks/figures
    // each implement one narrow port, composed here. The owner guard (#414) reads the index files
    // themselves, so it needs nothing from the caller and no store exists without it.
    this.#guard = new IndexFileOwners(cfg.indexDir);
    this.#conn = new IndexConnections(cfg, log, this.#guard);
    this.#freshness = new SqliteFreshness(this.#conn);
    // Resolved per call, so a spy on this.loadCandidates sees the cache's SQL reads.
    this.#chunks = new SqliteChunkIndex(this.#conn, log, (l) => this.loadCandidates(l));
    this.#figures = new SqliteFigureIndex(this.#conn);
    this.#sections = new SqliteSectionIndex(this.#conn);
    // Any write (even a rolled-back one — a needless reload is harmless) marks its books stale
    // in both candidate caches; the next vector query re-reads just those books (#370).
    this.#writer = new SqliteWriter(this.#conn, (l, ids) => {
      this.#chunks.invalidate(l, ids);
      this.#figures.invalidate(l, ids);
    });
  }

  /** The case-insensitive id clash that refuses this library its index, if any (LibraryIdCheck). */
  libraryIdCollision(libraryId: string): LibraryIdCollisionError | undefined {
    return this.#guard.collision(libraryId);
  }

  /** Whether an index file exists for the library; creates none (IndexFreshness). */
  hasIndex(libraryId: string): boolean {
    return this.#freshness.hasIndex(libraryId);
  }

  /** The stored index metadata, or undefined without an index (IndexFreshness). */
  indexMeta(libraryId: string, opts?: { diagnostic?: boolean }): IndexMeta | undefined {
    return this.#freshness.indexMeta(libraryId, opts);
  }

  /** Whether the index holds any embedding vectors; false for a keyword-only build (IndexFreshness). */
  hasVectors(libraryId: string): boolean {
    return this.#freshness.hasVectors(libraryId);
  }

  /** Whether the book is indexed and fresh for `lastModified` (IndexFreshness). */
  isBookIndexed(
    libraryId: string,
    bookId: number,
    lastModified?: string,
    opts?: { requireVectors?: boolean },
  ): boolean {
    return this.#freshness.isBookIndexed(libraryId, bookId, lastModified, opts);
  }

  /** One book's stored chunk spans, sorted by start (IndexFreshness). */
  bookChunkSpans(libraryId: string, bookId: number): ChunkSpan[] {
    return this.#freshness.bookChunkSpans(libraryId, bookId);
  }

  /** Embedded chunks of one book (IndexFreshness). */
  bookVectorCount(libraryId: string, bookId: number): number {
    return this.#freshness.bookVectorCount(libraryId, bookId);
  }

  /** Books whose chunks are not all embedded (IndexFreshness). */
  booksMissingVectors(libraryId: string): number {
    return this.#freshness.booksMissingVectors(libraryId);
  }

  /** Books whose stems another stemmer set wrote (IndexFreshness, #654). */
  booksWithStaleStems(libraryId: string): number {
    return this.#freshness.booksWithStaleStems(libraryId);
  }

  /** Every book id in the index, the prune diff input (IndexFreshness). */
  indexedBookIds(libraryId: string): number[] {
    return this.#freshness.indexedBookIds(libraryId);
  }

  /** Book, chunk and figure counts of the library's index (IndexFreshness). */
  stats(libraryId: string): { books: number; chunks: number; figures: number } {
    return this.#freshness.stats(libraryId);
  }

  /** Number of stored embedding vectors (IndexFreshness). */
  vectorCount(libraryId: string): number {
    return this.#freshness.vectorCount(libraryId);
  }

  /** Replace one book's rows in one transaction (IndexWriter). */
  replaceBook(
    libraryId: string,
    meta: BookMeta,
    chunks: IndexedChunk[],
    figures?: IndexedFigure[],
    opts?: { preserveEmbedded?: boolean; sections?: BookSections; offsetMap?: string; metadata?: IndexedBookMetadata },
  ): ReplaceOutcome {
    return this.#writer.replaceBook(libraryId, meta, chunks, figures, opts);
  }

  /** Rewrite one book's metadata and flags without re-chunking; false when its spans changed (IndexWriter). */
  refreshBookMeta(libraryId: string, meta: BookMeta, check: RefreshCheck): boolean {
    return this.#writer.refreshBookMeta(libraryId, meta, check);
  }

  /** Drop every row of these books (IndexWriter). */
  deleteBooks(libraryId: string, bookIds: number[], opts?: { noWait?: boolean }): PruneCounts {
    return this.#writer.deleteBooks(libraryId, bookIds, opts);
  }

  /** Vector half: rank books by their best passage (ChunkIndex). */
  searchLibrary(libraryId: string, query: Float32Array, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    return this.#chunks.searchLibrary(libraryId, query, k, allow);
  }

  /** The metadata list: rank books by their metadata row's vector (BookMetadataIndex, #631). */
  searchLibraryMetadata(libraryId: string, query: Float32Array, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    return searchBookMetadata(this.#conn.db(libraryId), query, k, allow);
  }

  /** Vector half: rank passages within one book (ChunkIndex). */
  searchBook(libraryId: string, bookId: number, query: Float32Array, k: number): BookHit[] {
    return this.#chunks.searchBook(libraryId, bookId, query, k);
  }

  /** Keyword half: rank books by their best FTS5 match; `query` as typed (ChunkIndex). */
  searchLibraryFts(libraryId: string, query: string, k: number, allow?: ReadonlySet<number>): LibraryHit[] {
    return this.#chunks.searchLibraryFts(libraryId, query, k, allow);
  }

  /** Keyword half: rank passages within one book; `query` as typed (ChunkIndex). */
  searchBookFts(libraryId: string, bookId: number, query: string, k: number): BookHit[] {
    return this.#chunks.searchBookFts(libraryId, bookId, query, k);
  }

  /** The query words the keyword plan leaves out, for the debug output (KeywordPlanReport). */
  keywordDropped(libraryId: string, query: string): KeywordDrop[] | undefined {
    return this.#chunks.keywordDropped(libraryId, query);
  }

  /** The chunk holding a character offset, for figure → context (ChunkIndex). */
  chunkAt(libraryId: string, bookId: number, charOffset: number): ChunkRef | undefined {
    return this.#chunks.chunkAt(libraryId, bookId, charOffset);
  }

  /** Vector half over figure captions, the library or one book (FigureIndex). */
  searchFigures(
    libraryId: string,
    query: Float32Array,
    k: number,
    bookId?: number,
    allow?: ReadonlySet<number>,
  ): FigureHit[] {
    return this.#figures.searchFigures(libraryId, query, k, bookId, allow);
  }

  /** Keyword half over figure captions; `query` as typed (FigureIndex). */
  searchFiguresFts(
    libraryId: string,
    query: string,
    k: number,
    bookId?: number,
    allow?: ReadonlySet<number>,
  ): FigureHit[] {
    return this.#figures.searchFiguresFts(libraryId, query, k, bookId, allow);
  }

  /** Indexed-figure count of the library or one book (FigureIndex). */
  figureCount(libraryId: string, bookId?: number): number {
    return this.#figures.figureCount(libraryId, bookId);
  }

  /** Figures whose marker falls inside a text span (FigureIndex). */
  figuresInSpan(libraryId: string, bookId: number, charStart: number, charEnd: number): FigureRef[] {
    return this.#figures.figuresInSpan(libraryId, bookId, charStart, charEnd);
  }

  /** The section path at a character offset, top level first (SectionIndex). */
  sectionPathAt(libraryId: string, bookId: number, charOffset: number): SectionRef[] {
    return this.#sections.sectionPathAt(libraryId, bookId, charOffset);
  }

  /** Close the connections and drop the in-memory chunk and figure caches. */
  close(): void {
    this.#conn.close();
    this.#chunks.clear();
    this.#figures.clear();
  }

  /**
   * Read + decode ALL embedding BLOBs of a library — the path the candidate cache avoids.
   * @internal public only as a spy seam for the cache tests; not part of `IndexStore`.
   */
  loadCandidates(libraryId: string): ChunkMatrix {
    return loadChunkMatrix(this.#conn.db(libraryId));
  }
}
