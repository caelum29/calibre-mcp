// Section spans in the index (#695): the row writer the whole-book replace and the in-place
// refresh share, and the hit-location reads (#708): offset → section path, offset → PDF page.
// Display and navigation only; nothing here touches ranking.

import type { DatabaseSync } from "node:sqlite";
import { toMatterKind } from "../../domain/structure/matter-kind.js";
import { type BookSections, sectionPathAt, toSectionSource } from "../../domain/structure/sections.js";
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
    // SQL narrows to the rows holding the offset; the domain helper picks the deepest and walks
    // its parents, so the path rule lives in one place (#708).
    const rows = this.conn
      .db(libraryId)
      .prepare(
        `SELECT id, parent_id, level, title, char_start, char_end, matter_kind, source FROM sections
         WHERE book_id = ? AND char_start <= ? AND ? < char_end ORDER BY char_start, level`,
      )
      .all(bookId, charOffset, charOffset) as Row[];
    const refs: SectionRef[] = rows.map((r) => ({
      id: Number(r.id),
      parentId: r.parent_id === null ? null : Number(r.parent_id),
      level: Number(r.level),
      title: String(r.title),
      charStart: Number(r.char_start),
      charEnd: Number(r.char_end),
      matterKind: toMatterKind(r.matter_kind),
      source: toSectionSource(r.source),
    }));
    const at = new Map(refs.map((r, i) => [r.id, i]));
    const spans = refs.map((r) => ({ ...r, parent: r.parentId === null ? null : (at.get(r.parentId) ?? null) }));
    return sectionPathAt(spans, charOffset).map(({ parent: _parent, ...ref }) => ref);
  }

  pageAt(libraryId: string, bookId: number, charOffset: number): number | undefined {
    if (!this.conn.has(libraryId)) return undefined;
    const db = this.conn.db(libraryId);
    const hit = db
      .prepare("SELECT char_start, body FROM chunks WHERE book_id = ? AND char_start <= ? AND ? < char_end LIMIT 1")
      .get(bookId, charOffset, charOffset) as Row | undefined;
    if (!hit) return undefined;
    const hitStart = Number(hit.char_start);
    // Chunks are exact, consecutive slices of the cleaned text (ADR-0033 keeps its `\f`), so the
    // page breaks before the hit are the `\f`s in the chunks before it, counted in SQL.
    const before = db
      .prepare(
        `SELECT COALESCE(SUM(char_end - char_start), 0) AS covered,
                COALESCE(SUM(length(body) - length(replace(body, char(12), ''))), 0) AS breaks
         FROM chunks WHERE book_id = ? AND char_end <= ?`,
      )
      .get(bookId, hitStart) as Row;
    // A gap or an overlap (a dropped chunk, an older chunker) would miscount: no page then.
    // Known limit: a whitespace-only chunk the chunker drops mid-book leaves such a gap, so every
    // later hit in that book has no page (safe: absent, never wrong).
    if (Number(before.covered) !== hitStart) return undefined;
    const body = String(hit.body ?? "");
    const breaks = Number(before.breaks) + countBreaks(body.slice(0, charOffset - hitStart));
    if (breaks > 0) return breaks + 1;
    // Page 1 or no pages at all: only a text with page breaks (PDF) has page numbers.
    if (body.includes("\f")) return 1;
    const paged = db
      .prepare("SELECT 1 FROM chunks WHERE book_id = ? AND char_start > ? AND instr(body, char(12)) > 0 LIMIT 1")
      .get(bookId, hitStart);
    return paged ? 1 : undefined;
  }

  indexedTextEnd(libraryId: string, bookId: number): number | undefined {
    if (!this.conn.has(libraryId)) return undefined;
    const row = this.conn
      .db(libraryId)
      .prepare("SELECT MAX(char_end) AS e FROM chunks WHERE book_id = ?")
      .get(bookId) as Row | undefined;
    return row?.e === null || row?.e === undefined ? undefined : Number(row.e);
  }
}

/** Page breaks (`\f`) in `s`. */
function countBreaks(s: string): number {
  let n = 0;
  for (let i = s.indexOf("\f"); i !== -1; i = s.indexOf("\f", i + 1)) n++;
  return n;
}
