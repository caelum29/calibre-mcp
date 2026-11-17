// Packed chunk-vector cache of one library (#618): every chunk vector in one flat Float32Array,
// rows grouped by book (ascending book id, then chunk id). Library scope is one pass keeping the
// best row per book, and a refresh copies unchanged books' rows instead of re-decoding BLOBs.

import { EMBED_DIM } from "../model.js";
import { type Candidate, dotAt, type ScoredHit, topK } from "../vector.js";

/** The packed vectors of one library, rows grouped by book. */
export interface ChunkMatrix {
  /** rows × EMBED_DIM floats; row r starts at r × EMBED_DIM. */
  vectors: Float32Array;
  /** Chunk id of each row, parallel to `vectors`. */
  chunkIds: Int32Array;
  /** Book ids in ascending order, one per row range. */
  bookIds: Int32Array;
  /** Book i owns rows [bookStart[i], bookStart[i + 1]); length bookIds.length + 1. */
  bookStart: Int32Array;
  /** Book id → its index in `bookIds`. */
  bookIndex: Map<number, number>;
}

const INT32_MAX = 2 ** 31 - 1;

/** Empty row arrays and book table for `counts` (book id → row count), books ascending. */
function layout(counts: ReadonlyMap<number, number>): ChunkMatrix {
  const ids = [...counts.keys()].sort((x, y) => x - y);
  const bookIds = Int32Array.from(ids);
  const bookStart = new Int32Array(ids.length + 1);
  const bookIndex = new Map<number, number>();
  ids.forEach((id, i) => {
    bookIndex.set(id, i);
    bookStart[i + 1] = bookStart[i]! + counts.get(id)!;
  });
  const rows = bookStart[ids.length]!;
  return { vectors: new Float32Array(rows * EMBED_DIM), chunkIds: new Int32Array(rows), bookIds, bookStart, bookIndex };
}

/**
 * Fills a matrix whose per-book row counts are known up front: rows may arrive in any book order,
 * but within a book in ascending chunk id (the loader scans in chunk-id order). Every slot must be
 * filled before `finish`; a mismatch means the rows changed under the count and throws.
 */
export class MatrixWriter {
  readonly #m: ChunkMatrix;
  /** Next free row per book index. */
  readonly #next: Int32Array;

  constructor(counts: ReadonlyMap<number, number>) {
    this.#m = layout(counts);
    this.#next = this.#m.bookStart.slice(0, -1);
  }

  /** Copy `vector` into the next row of `bookId`. */
  place(bookId: number, chunkId: number, vector: Float32Array): void {
    const m = this.#m;
    const b = m.bookIndex.get(bookId);
    if (b === undefined) throw new Error(`chunk matrix: no rows reserved for book ${bookId}`);
    const row = this.#next[b]!;
    if (row >= m.bookStart[b + 1]!) throw new Error(`chunk matrix: more rows than counted for book ${bookId}`);
    if (row > m.bookStart[b]! && chunkId <= m.chunkIds[row - 1]!) {
      throw new Error(`chunk matrix: book ${bookId} rows must arrive in ascending chunk id`);
    }
    // Int32Array would wrap a larger rowid silently into a wrong chunk.
    if (chunkId > INT32_MAX) throw new Error(`chunk matrix: chunk id ${chunkId} exceeds int32`);
    m.vectors.set(vector, row * EMBED_DIM);
    m.chunkIds[row] = chunkId;
    this.#next[b] = row + 1;
  }

  /** The filled matrix; throws while any book still has unfilled rows. */
  finish(): ChunkMatrix {
    const m = this.#m;
    for (let b = 0; b < m.bookIds.length; b++) {
      if (this.#next[b] !== m.bookStart[b + 1]) {
        throw new Error(`chunk matrix: book ${m.bookIds[b]} has fewer rows than counted`);
      }
    }
    return m;
  }
}

/** Number of rows of `m`. */
export function matrixRows(m: ChunkMatrix): number {
  return m.chunkIds.length;
}

/**
 * Library scope: the best row of every book (allowed by `allow`), books by score desc then book id,
 * first `k`. Equal to today's full topK sort + first chunk per book: within a book a strict ">" over
 * ascending chunk ids keeps the lowest chunk among equal scores. A book outside `allow` is skipped
 * before any of its rows is scored, so a restricted ranking is the unfiltered one ∩ allow (#93).
 */
export function libraryTop(m: ChunkMatrix, query: Float32Array, k: number, allow?: ReadonlySet<number>): ScoredHit[] {
  const books = m.bookIds.length;
  // Float64, not Float32: dot() returns a double, and rounding would change scores and merge near-ties.
  const best = new Float64Array(books);
  const bestChunk = new Int32Array(books);
  const scored: number[] = [];
  for (let b = 0; b < books; b++) {
    if (allow !== undefined && !allow.has(m.bookIds[b]!)) continue;
    const end = m.bookStart[b + 1]!;
    let row = m.bookStart[b]!;
    let top = dotAt(query, m.vectors, row * EMBED_DIM);
    let topRow = row;
    for (row++; row < end; row++) {
      const s = dotAt(query, m.vectors, row * EMBED_DIM);
      if (s > top) {
        top = s;
        topRow = row;
      }
    }
    best[b] = top;
    bestChunk[b] = m.chunkIds[topRow]!;
    scored.push(b);
  }
  scored.sort((x, y) => best[y]! - best[x]! || m.bookIds[x]! - m.bookIds[y]!);
  // k < 1 still yields one book, as the pre-#618 loop did (it checked the count after adding).
  return scored
    .slice(0, Math.max(1, k))
    .map((b) => ({ chunkId: bestChunk[b]!, bookId: m.bookIds[b]!, score: best[b]! }));
}

/** Book scope: that book's rows through `topK` (score desc, book id, chunk id), first `k`. */
export function bookTop(m: ChunkMatrix, bookId: number, query: Float32Array, k: number): ScoredHit[] {
  const b = m.bookIndex.get(bookId);
  if (b === undefined) return [];
  const rows: Candidate[] = [];
  for (let r = m.bookStart[b]!; r < m.bookStart[b + 1]!; r++) {
    rows.push({ chunkId: m.chunkIds[r]!, bookId, vector: m.vectors.subarray(r * EMBED_DIM, (r + 1) * EMBED_DIM) });
  }
  return topK(query, rows, k);
}

/**
 * The refreshed matrix: `old` without every `stale` book, plus every book of `fresh` (re-read from
 * SQLite; a stale book missing from it was deleted or lost its vectors). Unchanged books' rows are
 * typed-array copies, so the result equals a cold pack of the same rows without decoding them.
 */
export function mergeMatrix(old: ChunkMatrix, stale: ReadonlySet<number>, fresh: ChunkMatrix): ChunkMatrix {
  const counts = new Map<number, number>();
  const rowsOf = (m: ChunkMatrix, b: number) => m.bookStart[b + 1]! - m.bookStart[b]!;
  // A fresh book always wins over its old rows, even if the caller forgot to mark it stale.
  const keep = (id: number) => !stale.has(id) && !fresh.bookIndex.has(id);
  old.bookIds.forEach((id, b) => {
    if (keep(id)) counts.set(id, rowsOf(old, b));
  });
  fresh.bookIds.forEach((id, b) => counts.set(id, rowsOf(fresh, b)));
  const out = layout(counts);
  const copy = (src: ChunkMatrix, b: number) => {
    const from = src.bookStart[b]!;
    const to = src.bookStart[b + 1]!;
    const at = out.bookStart[out.bookIndex.get(src.bookIds[b]!)!]!;
    out.vectors.set(src.vectors.subarray(from * EMBED_DIM, to * EMBED_DIM), at * EMBED_DIM);
    out.chunkIds.set(src.chunkIds.subarray(from, to), at);
  };
  old.bookIds.forEach((id, b) => {
    if (keep(id)) copy(old, b);
  });
  fresh.bookIds.forEach((_, b) => copy(fresh, b));
  return out;
}
