// The index write side (#272): whole-book replace, in-place meta refresh, prune. Every write
// takes the lock up front (BEGIN IMMEDIATE, #196) and invalidates the library's candidate
// caches through the injected callback, even when it rolls back.

import type { DatabaseSync } from "node:sqlite";
import type { ChunkSpan } from "../content-match.js";
import { isFrontMatterSpan } from "../front-matter-flag.js";
import { stemText } from "../stem.js";
import { encodeVector } from "../vector.js";
import { chunkSpans, vectorCoverage } from "./freshness.js";
import type { IndexConnections } from "./schema.js";
import { type Row, rollbackQuietly } from "./shared.js";
import type {
  BookMeta,
  IndexedChunk,
  IndexedFigure,
  IndexWriter,
  PruneCounts,
  RefreshCheck,
  ReplaceOutcome,
} from "./types.js";

/** IndexWriter over the shared connections; `invalidate` drops a library's candidate caches. */
export class SqliteWriter implements IndexWriter {
  constructor(
    private readonly conn: IndexConnections,
    private readonly invalidate: (libraryId: string) => void,
  ) {}

  replaceBook(
    libraryId: string,
    meta: BookMeta,
    chunks: IndexedChunk[],
    figures: IndexedFigure[] = [],
    opts: { preserveEmbedded?: boolean } = {},
  ): ReplaceOutcome {
    const db = this.conn.db(libraryId);
    const embedded = chunks.reduce((n, c) => n + (c.vector ? 1 : 0), 0);
    // IMMEDIATE takes the write lock up front, where busy_timeout applies (#196) — a deferred
    // BEGIN that upgrades to a writer mid-transaction can fail with SQLITE_BUSY without waiting —
    // and the preserve check below reads the state it then overwrites with no writer in between.
    // Callers compute every embedding BEFORE this point, so the lock is never held over the model.
    db.exec("BEGIN IMMEDIATE");
    try {
      if (opts.preserveEmbedded && embedded === 0) {
        const v = vectorCoverage(db, meta.bookId);
        if (v !== undefined && v.embedded > 0) {
          db.exec("ROLLBACK");
          return "preserved";
        }
      }
      db.prepare("DELETE FROM embeddings WHERE book_id = ?").run(meta.bookId);
      db.prepare("DELETE FROM chunks WHERE book_id = ?").run(meta.bookId);
      db.prepare("DELETE FROM figures WHERE book_id = ?").run(meta.bookId);
      db.prepare("DELETE FROM books WHERE book_id = ?").run(meta.bookId);

      db.prepare(
        "INSERT INTO books(book_id, title, authors, last_modified, chunk_count, indexed_at, embedded_chunks) VALUES(?,?,?,?,?,?,?)",
      ).run(
        meta.bookId,
        meta.title,
        JSON.stringify(meta.authors),
        meta.lastModified ?? null,
        chunks.length,
        new Date().toISOString(),
        embedded,
      );

      const insChunk = db.prepare(
        "INSERT INTO chunks(book_id, char_start, char_end, body, body_stem, book_meta, front_matter) VALUES(?,?,?,?,?,?,?)",
      );
      const insEmb = db.prepare("INSERT INTO embeddings(chunk_id, book_id, vector) VALUES(?,?,?)");
      // Stemmed once per book (same transform as body_stem/queries) and repeated on every
      // chunk row, so the FTS half sees book identity — the vector half already gets it via
      // the embedded "[title › authors]" context prefix.
      const bookMeta = bookMetaStem(meta);
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
      return "written";
    } catch (err) {
      rollbackQuietly(db);
      throw err;
    } finally {
      // Any write (even a rolled-back one — a needless rebuild is harmless) drops the
      // library's candidate caches; the next vector query rebuilds them from SQLite.
      this.invalidate(libraryId);
    }
  }

  refreshBookMeta(libraryId: string, meta: BookMeta, check: RefreshCheck): boolean {
    const db = this.conn.db(libraryId);
    const bookMeta = bookMetaStem(meta);
    // IMMEDIATE for the same reason as replaceBook (#196): wait on another writer's lock — and
    // the span re-check below then sees exactly the rows this transaction updates.
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!sameSpans(chunkSpans(db, meta.bookId), check.spans)) {
        db.exec("ROLLBACK");
        return false;
      }
      db.prepare("UPDATE books SET title = ?, authors = ?, last_modified = ?, indexed_at = ? WHERE book_id = ?").run(
        meta.title,
        JSON.stringify(meta.authors),
        meta.lastModified ?? null,
        new Date().toISOString(),
        meta.bookId,
      );
      // The AFTER UPDATE triggers re-sync chunk_fts / figure_fts with the new book_meta.
      db.prepare("UPDATE chunks SET book_meta = ? WHERE book_id = ?").run(bookMeta, meta.bookId);
      db.prepare("UPDATE figures SET book_meta = ? WHERE book_id = ?").run(bookMeta, meta.bookId);
      this.#refreshFrontMatter(db, meta.bookId, check.frontMatterEnd);
      db.exec("COMMIT");
      return true;
    } catch (err) {
      rollbackQuietly(db);
      throw err;
    } finally {
      // Same wholesale invalidation as replaceBook — correctness over cleverness.
      this.invalidate(libraryId);
    }
  }

  /** Flag-only backfill (#269): rewrite just the chunks whose front-matter flag changes. */
  #refreshFrontMatter(db: DatabaseSync, bookId: number, fmEnd: number): void {
    const rows = db
      .prepare("SELECT id, char_start, char_end, front_matter FROM chunks WHERE book_id = ?")
      .all(bookId) as Row[];
    const set = db.prepare("UPDATE chunks SET front_matter = ? WHERE id = ?");
    for (const r of rows) {
      const want = isFrontMatterSpan({ charStart: Number(r.char_start), charEnd: Number(r.char_end) }, fmEnd) ? 1 : 0;
      if (Number(r.front_matter ?? 0) !== want) set.run(want, Number(r.id));
    }
  }

  deleteBooks(libraryId: string, bookIds: number[]): PruneCounts {
    const counts: PruneCounts = { books: 0, chunks: 0, figures: 0 };
    if (bookIds.length === 0 || !this.conn.has(libraryId)) return counts;
    const db = this.conn.db(libraryId);
    // IMMEDIATE takes the write lock up front, where busy_timeout applies (#196); a deferred
    // BEGIN that upgrades to a writer mid-transaction can fail with SQLITE_BUSY without waiting.
    db.exec("BEGIN IMMEDIATE");
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
      rollbackQuietly(db);
      throw err;
    } finally {
      this.invalidate(libraryId);
    }
  }
}

/** Stemmed "title authors" repeated on every chunk/figure row, so FTS sees book identity. */
function bookMetaStem(meta: BookMeta): string {
  return stemText(`${meta.title} ${meta.authors.join(" ")}`);
}

/** Same chunk set: count, offsets and bodies, in order. */
function sameSpans(a: readonly ChunkSpan[], b: readonly ChunkSpan[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.charStart === b[i]!.charStart && s.charEnd === b[i]!.charEnd && s.body === b[i]!.body)
  );
}
