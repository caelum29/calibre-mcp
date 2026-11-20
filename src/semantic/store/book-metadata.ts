// Per-book metadata row in the index (#631): the row writer the whole-book replace and the
// in-place refresh share, and the metadata list library hybrid fuses as its third RRF list (its
// weight is 0 by default, so shipped searches never read it). Own table + FTS index: schema.ts.

import type { DatabaseSync } from "node:sqlite";
import { stemText } from "../stem.js";
import { decodeVector, dot, encodeVector } from "../vector.js";
import { parseAuthors, type Row } from "./shared.js";
import type { IndexedBookMetadata, LibraryHit } from "./types.js";

/**
 * Replace one book's metadata row. Runs inside the caller's transaction, so the row changes
 * exactly when the book's other rows do; `undefined` clears it. The insert trigger keeps
 * book_metadata_fts in sync. `lang` is the book's language pack (#654), as for its chunks.
 */
export function writeBookMetadata(
  db: DatabaseSync,
  bookId: number,
  lastModified: string | undefined,
  row: IndexedBookMetadata | undefined,
  lang?: string,
): void {
  db.prepare("DELETE FROM book_metadata WHERE book_id = ?").run(bookId);
  if (!row) return;
  db.prepare(
    "INSERT INTO book_metadata(book_id, body, body_stem, blurb_chars, last_modified, vector) VALUES(?,?,?,?,?,?)",
  ).run(
    bookId,
    row.text,
    // Same stemmer as chunk bodies and queries, so a later keyword list matches the same way.
    stemText(row.text, lang),
    row.blurbChars,
    lastModified ?? null,
    row.vector ? encodeVector(row.vector) : null,
  );
}

/**
 * The metadata list (#631): books ranked by the cosine of their metadata row's vector, best first,
 * equal scores by ascending book id, up to k; `allow` restricts before ranking. Rows without a
 * vector (keyword-only builds) are skipped. Brute force over every row on each call, no cache:
 * one row per book (about 1,100 on the largest library), and only a weight above 0 calls it.
 */
export function searchBookMetadata(
  db: DatabaseSync,
  query: Float32Array,
  k: number,
  allow?: ReadonlySet<number>,
): LibraryHit[] {
  const rows = db
    .prepare(
      "SELECT m.book_id, m.body, m.blurb_chars, m.vector, b.title, b.authors FROM book_metadata m " +
        "JOIN books b ON b.book_id = m.book_id WHERE m.vector IS NOT NULL",
    )
    .all() as Row[];
  const scored = rows
    .filter((r) => allow === undefined || allow.has(Number(r.book_id)))
    .map((r) => ({ r, score: dot(query, decodeVector(r.vector as Uint8Array)) }))
    .sort((a, b) => b.score - a.score || Number(a.r.book_id) - Number(b.r.book_id));
  return scored.slice(0, k).map(({ r, score }): LibraryHit => {
    const body = String(r.body);
    const blurbChars = Number(r.blurb_chars);
    return {
      bookId: Number(r.book_id),
      chunkId: 0,
      title: String(r.title),
      authors: parseAuthors(r.authors),
      score,
      // the blurb closes the row text (bookMetadataText); a row without one shows itself
      snippet: blurbChars > 0 ? body.slice(body.length - blurbChars) : body,
      body,
      charStart: 0,
      charEnd: 0,
      from: "description",
    };
  });
}
