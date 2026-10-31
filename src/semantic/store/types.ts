// Index-store data types and the narrow ports it is split into (#272): IndexFreshness,
// IndexWriter, ChunkIndex and FigureIndex. Callers and test fakes depend on the port they use;
// IndexStore is their union plus close().

import type { ChunkSpan } from "../content-match.js";

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

/**
 * What built an index, as persisted in its `meta` table (#136) — the citation provenance:
 * stored char offsets / figure pages are valid only within one `indexVersion`.
 */
export interface IndexMeta {
  modelId: string;
  dim: number;
  indexVersion: number;
  /** ISO timestamp the index db was first created; absent on hand-built/legacy metas. */
  createdAt?: string;
}

/** What an in-place refresh was verified against, and the front-matter boundary to apply. */
export interface RefreshCheck {
  frontMatterEnd: number;
  spans: readonly ChunkSpan[];
}

/** What replaceBook did: wrote the rows, or kept an embedded book's rows untouched. */
export type ReplaceOutcome = "written" | "preserved";

/** Freshness/coverage reads: what is indexed, how completely, and with what provenance. */
export interface IndexFreshness {
  /** Cheap, side-effect-free check for an existing index (no db file is created). */
  hasIndex(libraryId: string): boolean;
  /**
   * The index's persisted meta, read WITHOUT the compatibility guard — so a stale index
   * (built by another model/INDEX_VERSION) can still be described. Undefined when there is
   * no index or its meta is unreadable. Never creates a db file.
   */
  indexMeta(libraryId: string): IndexMeta | undefined;
  /** True if the index holds any embedding vectors (false = a keyword-only build). */
  hasVectors(libraryId: string): boolean;
  /**
   * True if the book is indexed; when `lastModified` is given, also that it's up to date.
   * `requireVectors` (a semantic-capable build, #197) additionally demands that EVERY chunk
   * has an embedding — a keyword-only or half-written entry is then not fresh.
   */
  isBookIndexed(libraryId: string, bookId: number, lastModified?: string, opts?: { requireVectors?: boolean }): boolean;
  /** One book's stored chunk spans, sorted by charStart (empty when not indexed). */
  bookChunkSpans(libraryId: string, bookId: number): ChunkSpan[];
  /** Embedded chunks of one book (0 when not indexed or for an absent index). */
  bookVectorCount(libraryId: string, bookId: number): number;
  /** Books whose chunks are not all embedded (keyword-only or partial entries); 0 for an absent index. */
  booksMissingVectors(libraryId: string): number;
  /** Every book id currently in the index (empty for an absent index) — the prune diff input. */
  indexedBookIds(libraryId: string): number[];
  stats(libraryId: string): { books: number; chunks: number; figures: number };
  /** Number of stored embedding vectors (0 for a keyword-only or absent index). Cheap COUNT. */
  vectorCount(libraryId: string): number;
}

/** The write side: whole-book replace, in-place meta refresh, prune. */
export interface IndexWriter {
  /**
   * Replace all of a book's rows (books/chunks/embeddings/FTS/figures) in ONE transaction —
   * a failure leaves the previous rows intact. Returns "preserved" (nothing written) when
   * `preserveEmbedded` is set, the new rows carry no vectors, and the stored book has
   * embeddings: a keyword-only writer never silently downgrades an embedded book (#197).
   */
  replaceBook(
    libraryId: string,
    meta: BookMeta,
    chunks: IndexedChunk[],
    figures?: IndexedFigure[],
    opts?: { preserveEmbedded?: boolean },
  ): ReplaceOutcome;
  /**
   * In-place refresh of an unchanged-text book (#244/#269): title/authors/last_modified, the
   * per-chunk/per-figure book_meta (FTS follows via the update triggers) and the front-matter
   * flags re-derived from `frontMatterEnd` — one transaction, chunks and vectors kept. Returns
   * false and writes NOTHING when the book's stored spans are no longer `spans` (another
   * writer re-chunked it after the caller verified the text).
   */
  refreshBookMeta(libraryId: string, meta: BookMeta, check: RefreshCheck): boolean;
  /** Drop all rows for these books (books/chunks/embeddings/figures + FTS shadows). */
  deleteBooks(libraryId: string, bookIds: number[]): PruneCounts;
}

/** Chunk retrieval: vector + keyword halves over passages, and figure → context lookup. */
export interface ChunkIndex {
  /**
   * Rank books by their single best-matching chunk (best chunk per book), vector cosine.
   * `allow` (bundle filter, #93) restricts candidates BEFORE ranking — the result is exactly
   * the unfiltered ranking intersected with the set, order preserved (brute-force is exact).
   */
  searchLibrary(libraryId: string, query: Float32Array, k: number, allow?: ReadonlySet<number>): LibraryHit[];
  /** Rank passages within one book, vector cosine. */
  searchBook(libraryId: string, bookId: number, query: Float32Array, k: number): BookHit[];
  /** Keyword half: rank books by best weighted-bm25 FTS5 match (score is negative, lower is better). */
  searchLibraryFts(libraryId: string, stemmedQuery: string, k: number, allow?: ReadonlySet<number>): LibraryHit[];
  /** Keyword half: rank passages within one book by weighted-bm25 FTS5 match. */
  searchBookFts(libraryId: string, bookId: number, stemmedQuery: string, k: number): BookHit[];
  /** The chunk containing a figure marker offset (figure → context direction). */
  chunkAt(libraryId: string, bookId: number, charOffset: number): ChunkRef | undefined;
}

/** Figure-caption retrieval and the text-span → figures direction. */
export interface FigureIndex {
  /** Rank figure captions by vector cosine — the whole library, or one book. */
  searchFigures(
    libraryId: string,
    query: Float32Array,
    k: number,
    bookId?: number,
    allow?: ReadonlySet<number>,
  ): FigureHit[];
  /** Keyword half over figure captions (weighted-bm25 FTS5). */
  searchFiguresFts(
    libraryId: string,
    stemmedQuery: string,
    k: number,
    bookId?: number,
    allow?: ReadonlySet<number>,
  ): FigureHit[];
  /** Indexed-figure count (library or one book); 0 for an absent index. Cheap COUNT. */
  figureCount(libraryId: string, bookId?: number): number;
  /** Figures whose marker falls inside a chunk span (text hit → figures direction). */
  figuresInSpan(libraryId: string, bookId: number, charStart: number, charEnd: number): FigureRef[];
}

/** The full store: every port plus lifecycle. Callers that need less depend on a port. */
export interface IndexStore extends IndexFreshness, IndexWriter, ChunkIndex, FigureIndex {
  close(): void;
}
