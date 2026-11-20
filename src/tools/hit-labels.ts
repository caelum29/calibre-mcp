// Location labels of a calibre_semantic_search text hit (ADR-0034, #708): its section path and
// its PDF page, each a Labelled line right before the hit's fence and a declared field, and
// each absent, never empty, when the data is missing or disagrees with the hit's chunk.

import { z } from "zod";
import { hitSectionPath } from "../domain/structure/sections.js";
import type { SectionIndex } from "../semantic/store/index.js";
import { HIT_LINE_LABELS, labelledLine, SECTION_PATH_SEPARATOR } from "./labelled-lines.js";

/** outputSchema field of a text hit's section path, the twin of its `section:` line. */
export const SectionPathSchema = z
  .array(z.string())
  .describe(
    "Section titles at the hit, outermost first, at most the last 3 levels (the `section:` line). Absent when the book has no section spans there.",
  );

/** outputSchema field of a text hit's page, the twin of its `page:` line. */
export const TextPageSchema = z
  .number()
  .describe(
    "PDF only: the 1-based PDF page index of the hit (never the printed page number; the `page:` line), counted as figure hits count it. Absent for EPUB and other unpaged texts.",
  );

/** A text hit's location labels; each absent when its data is missing. */
export interface HitLabels {
  sectionPath?: string[];
  page?: number;
}

/** Where a label is read: the book and its deciding offset. */
export interface LabelAt {
  libraryId: string;
  bookId: number;
  /** The snippet's start at library scope, the chunk's start at book scope (ADR-0034 item 6). */
  offset: number;
}

/** The labels at `at` for a hit on `chunk`: the section path (last 3 levels) and the PDF page. */
export function hitLabels(index: SectionIndex, at: LabelAt, chunk: { charStart: number; charEnd: number }): HitLabels {
  const sectionPath = hitSectionPath(index.sectionPathAt(at.libraryId, at.bookId, at.offset), chunk);
  const page = index.pageAt(at.libraryId, at.bookId, at.offset);
  return { ...(sectionPath ? { sectionPath } : {}), ...(page !== undefined ? { page } : {}) };
}

/** The labels as Labelled lines, each newline-ended, to sit right before the hit's fence. */
export function labelLines(l: HitLabels): string {
  const section = l.sectionPath
    ? `${labelledLine(HIT_LINE_LABELS.section, l.sectionPath.join(SECTION_PATH_SEPARATOR))}\n`
    : "";
  const page = l.page !== undefined ? `${labelledLine(HIT_LINE_LABELS.page, String(l.page))}\n` : "";
  return section + page;
}
