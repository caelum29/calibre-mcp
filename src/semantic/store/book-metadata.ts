// Per-book metadata row in the index (#631, index side): the row writer the whole-book replace
// and the in-place refresh share. Its own table with its own FTS index (schema.ts); nothing reads
// it at query time yet — the third fusion list, rerank input and display come in wave 5.

import type { DatabaseSync } from "node:sqlite";
import { stemText } from "../stem.js";
import { encodeVector } from "../vector.js";
import type { IndexedBookMetadata } from "./types.js";

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
