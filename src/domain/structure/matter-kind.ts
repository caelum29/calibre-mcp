// Front and back matter per chunk (#605): one pure classifier shared by a full index and the
// flags-only refresh, so both store the same kinds for the same text. Search ranks body passages
// first; strong kinds (index, copyright/ads, prose-less front) never reach the reranker.

import { type ChapterSpan, detectChapters, type DetectOptions } from "./chapters.js";
import { frontMatterEnd } from "./front-matter.js";
import { isBibliographyTitle, isIndexTitle } from "./front-matter-titles.js";

/** Where a chunk sits in the book: before the body, in it, or one of three back-matter kinds. */
export type MatterKind = "front" | "body" | "back_index" | "back_biblio" | "back_other";

/** Every kind, in a fixed order (store codes and validation read it). */
export const MATTER_KINDS: readonly MatterKind[] = ["body", "front", "back_index", "back_biblio", "back_other"];

/** A stored kind string as a MatterKind; anything unknown reads as body. */
export function toMatterKind(raw: unknown): MatterKind {
  return MATTER_KINDS.find((k) => k === raw) ?? "body";
}

/** Where one chunk sits, for `classifyChunk`. */
export interface ChunkPlace {
  /** Chunk start ÷ text length, 0–1. */
  position: number;
  /** The majority of the chunk lies before the front-matter boundary (#18). */
  inFront: boolean;
  /** Heading of the chapter-map span the chunk starts in, when there is one. */
  heading?: string;
}

// Back-matter zone: index pages sat at median position 0.978 (p10 0.946) on the live library
// (2026-11-13 probe), so 0.85 leaves margin; copyright/ads pages also open books (first 10%).
const BACK_START = 0.85;
const FRONT_ZONE_END = 0.1;
// Index density: at least 8 non-empty lines, more than 40% ending in a page locator.
const INDEX_MIN_LINES = 8;
const INDEX_LOCATOR_SHARE = 0.4;
// Bibliography density: citation markers on ≥30% of non-empty lines, at least 4 such lines.
const BIBLIO_MIN_LINES = 4;
const BIBLIO_CITATION_SHARE = 0.3;

// "term, 123", "term, 123, 456", "term 289-292", "Retrieval .......... 21", "Preface ..... xi":
// a trailing page number or range after a space, comma or dot leader; roman only after a leader.
const PAGE_END = /(?:[\s,.]\d{1,4}(?:\s*[-–]\s*\d{1,4})?|\.{2,}\s*[ivxlc]{1,7})\s*$/u;
const LETTER = /\p{L}/u;
const CHAPTER_KEYWORD = /^\s*(?:chapter|part|section|appendix|глава|часть|раздел|розділ|частина|додаток)\b/iu;
const CITATION = /\((?:1[5-9]|20)\d{2}[a-z]?\)|\bpp\.|\bdoi:|\barxiv:/iu;
const LEGAL = /all rights reserved|\bISBN\b|printed in|library of congress|все права защищены/iu;

/** True when a line ends in a page number or range (index locators, table-of-contents entries). */
function endsInPage(line: string): boolean {
  return PAGE_END.test(line) && LETTER.test(line);
}

const nonEmptyLines = (chunk: string): string[] =>
  chunk
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * The prose guard (adapted from RAGFlow's table-of-contents page rule, Apache-2.0): a chunk
 * carries prose when it has more than 2 lines over 60 characters, or more than 2 lines over 20
 * characters without a marker (a trailing page number or a chapter keyword). A line that ends in
 * a page number never counts, whatever its length: PDF contents lines run long on dot leaders.
 */
export function carriesProse(chunk: string): boolean {
  let long = 0;
  let unmarked = 0;
  for (const line of nonEmptyLines(chunk)) {
    if (endsInPage(line)) continue;
    if (line.length > 60) long++;
    if (line.length > 20 && !CHAPTER_KEYWORD.test(line)) unmarked++;
  }
  return long > 2 || unmarked > 2;
}

/** Index page by density: ≥ INDEX_MIN_LINES non-empty lines, more than 40% ending in a locator. */
function locatorDense(lines: string[]): boolean {
  return lines.length >= INDEX_MIN_LINES && lines.filter(endsInPage).length > INDEX_LOCATOR_SHARE * lines.length;
}

/** Citation markers on ≥30% of non-empty lines, at least BIBLIO_MIN_LINES of them. */
function citationDense(lines: string[]): boolean {
  const cited = lines.filter((l) => CITATION.test(l)).length;
  return cited >= BIBLIO_MIN_LINES && cited >= BIBLIO_CITATION_SHARE * lines.length;
}

/**
 * The matter kind of one chunk; first match wins: front (the #18 boundary), back_index (past
 * 0.85, under an Index heading or locator-dense, and no prose), back_biblio (citation-dense and
 * either under a bibliography heading or past 0.85), back_other (legal/ads wording in the first
 * 10% or past 0.85), else body.
 */
export function classifyChunk(chunk: string, place: ChunkPlace): MatterKind {
  if (place.inFront) return "front";
  const lines = nonEmptyLines(chunk);
  const back = place.position > BACK_START;
  const heading = place.heading ?? "";
  if (back && (isIndexTitle(heading) || locatorDense(lines)) && !carriesProse(chunk)) return "back_index";
  // A bibliography heading may be the chapter-map span's or a whole line inside the chunk.
  if (citationDense(lines) && (back || isBibliographyTitle(heading) || lines.some(isBibliographyTitle))) {
    return "back_biblio";
  }
  if ((back || place.position < FRONT_ZONE_END) && LEGAL.test(chunk)) return "back_other";
  return "body";
}

/**
 * Strong kinds are certain enough to keep out of the rerank pool and below body hits: the index,
 * copyright/ads pages and front matter without prose (contents, praise lists). A bibliography
 * and prose front matter (a preface, say) are weak: real content may sit there.
 */
export function isStrongMatter(kind: MatterKind, chunk: string): boolean {
  if (kind === "back_index" || kind === "back_other") return true;
  return kind === "front" && !carriesProse(chunk);
}

/** True when a chunk lies MOSTLY before the front-matter boundary `fmEnd` (0 = none), #18. */
export function isFrontMatterSpan(span: { charStart: number; charEnd: number }, fmEnd: number): boolean {
  return fmEnd > 0 && Math.min(span.charEnd, fmEnd) - span.charStart >= 0.5 * (span.charEnd - span.charStart);
}

/** The chapter-map span a chunk starts in (spans are sorted and disjoint). */
function chapterAt(chapters: readonly ChapterSpan[], offset: number): ChapterSpan | undefined {
  return chapters.find((c) => c.startChar <= offset && offset < c.endChar);
}

/**
 * The matter kind of every chunk span of a book, in span order. Each chunk is read as
 * `text.slice(span)`, so a full index and a flags-only refresh of the same text agree.
 */
export function matterKinds(
  text: string,
  spans: ReadonlyArray<{ charStart: number; charEnd: number }>,
  opts: DetectOptions = {},
): MatterKind[] {
  if (spans.length === 0 || text.length === 0) return [];
  const fmEnd = frontMatterEnd(text, opts);
  const { chapters } = detectChapters(text, opts);
  return spans.map((s) => {
    const heading = chapterAt(chapters, s.charStart)?.heading;
    return classifyChunk(text.slice(s.charStart, s.charEnd), {
      position: s.charStart / text.length,
      inFront: isFrontMatterSpan(s, fmEnd),
      ...(heading !== undefined ? { heading } : {}),
    });
  });
}
