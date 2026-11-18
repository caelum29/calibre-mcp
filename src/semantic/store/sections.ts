// Section spans in the index (#695): the row writer the whole-book replace and the in-place
// refresh share, and the offset → section-path read. Spans are for display and navigation
// only; nothing here touches ranking.

import type { DatabaseSync } from "node:sqlite";
import { toMatterKind } from "../../domain/structure/matter-kind.js";
import { type BookSections, toSectionSource } from "../../domain/structure/sections.js";
import type { IndexConnections } from "./schema.js";
import type { Row } from "./shared.js";
import type { SectionIndex, SectionRef } from "./types.js";

/**
 * Replace one book's section rows. Runs inside the caller's transaction, so the rows change
 * exactly when the chunks do. Spans arrive in document order with `parent` as an index into
 * the same array; a parent always precedes its children, so its rowid is known on insert.
 */
export function writeSections(db: DatabaseSync, bookId: number, book: BookSections | undefined): void {
  db.prepare("DELETE FROM sections WHERE book_id = ?").run(bookId);
  if (!book?.source) return;
  const ins = db.prepare(
    "INSERT INTO sections(book_id, parent_id, level, title, char_start, char_end, matter_kind, source) VALUES(?,?,?,?,?,?,?,?)",
  );
  const ids: number[] = [];
  for (const s of book.sections) {
    const parentId = s.parent === null ? null : (ids[s.parent] ?? null);
    const { lastInsertRowid } = ins.run(
      bookId,
      parentId,
      s.level,
      s.title,
      s.charStart,
      s.charEnd,
      s.matterKind,
      book.source,
    );
    ids.push(Number(lastInsertRowid));
  }
}

/** SectionIndex over the shared connections. */
export class SqliteSectionIndex implements SectionIndex {
  constructor(private readonly conn: IndexConnections) {}

  sectionPathAt(libraryId: string, bookId: number, charOffset: number): SectionRef[] {
    // A read must never create a db file (same guard as figureCount).
    if (!this.conn.has(libraryId)) return [];
    // Spans nest, so the rows holding the offset are the deepest one's ancestor chain.
    const rows = this.conn
      .db(libraryId)
      .prepare(
        `SELECT id, parent_id, level, title, char_start, char_end, matter_kind, source FROM sections
         WHERE book_id = ? AND char_start <= ? AND ? < char_end ORDER BY level, char_start`,
      )
      .all(bookId, charOffset, charOffset) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      parentId: r.parent_id === null ? null : Number(r.parent_id),
      level: Number(r.level),
      title: String(r.title),
      charStart: Number(r.char_start),
      charEnd: Number(r.char_end),
      matterKind: toMatterKind(r.matter_kind),
      source: toSectionSource(r.source),
    }));
  }
}
