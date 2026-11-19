// Section spans of a book's extracted text (#695): level, title, parent and matter kind per
// span, stored at index time for display and navigation (never embedded, #620). Precedence:
// PDF outline, else EPUB TOC, else the chapter detectors. Pure and SDK-free.

import { scanPageStarts } from "../page-offsets.js";
import { detectChapters, type DetectOptions } from "./chapters.js";
import type { EpubToc } from "./epub-toc.js";
import { BODY_KIND, MATTER_KINDS, type MatterKind } from "./matter-kind.js";
import { findTitleLine, type OutlineEntry } from "./pdf-outline.js";

/** Where a book's spans came from, by precedence. */
export type SectionSource = "pdf-outline" | "epub-toc" | "chapters";

/** Every source, in precedence order. */
export const SECTION_SOURCES: readonly SectionSource[] = ["pdf-outline", "epub-toc", "chapters"];

/** A stored source string as a SectionSource; anything unknown reads as the weakest, "chapters". */
export function toSectionSource(raw: unknown): SectionSource {
  return SECTION_SOURCES.find((s) => s === raw) ?? "chapters";
}

/** One section of the book text, in the chunks' character coordinates. */
export interface SectionSpan {
  /** Title, whitespace collapsed, at most MAX_SECTION_TITLE chars. */
  title: string;
  /** Nesting depth, 1 = top level (parts are a level of their own). */
  level: number;
  /** Offset of the section start: its title line when found, else its page / spine-doc start. */
  charStart: number;
  /** Start of the next section at the same or a higher level (text end for the last). */
  charEnd: number;
  /** Index of the parent span in the same array; null at top level. */
  parent: number | null;
  /** The kind of the chunks covering most of the span (one classifier, #605). */
  matterKind: MatterKind;
}

/** All spans of one book in document order; `source` is null when no structure was found. */
export interface BookSections {
  source: SectionSource | null;
  sections: SectionSpan[];
}

/** Deepest outline / TOC level kept; deeper entries are sub-sub-sections nobody navigates by. */
export const MAX_SECTION_LEVEL = 4;
/** Longest stored title: a run-away outline entry must not bloat every row. */
export const MAX_SECTION_TITLE = 200;
// An outline or TOC needs at least this many placed entries to beat the text detectors.
const MIN_ENTRIES = 2;

interface Placed {
  title: string;
  level: number;
  start: number;
}

interface ChunkRange {
  charStart: number;
  charEnd: number;
}

/**
 * The section spans of `text`: from its PDF outline, else its EPUB TOC, else the chapter
 * detectors (level 1 only). `chunks`/`kinds` are the book's chunk spans and their matter kinds
 * from `matterKinds`, so a span's kind always agrees with the chunks it covers.
 */
export function bookSections(
  text: string,
  structure: DetectOptions,
  chunks: readonly ChunkRange[],
  kinds: readonly MatterKind[],
): BookSections {
  const pick = (): { source: SectionSource; placed: Placed[] } | null => {
    const outline = structure.outline ? placeOutline(text, structure.outline) : [];
    if (outline.length >= MIN_ENTRIES) return { source: "pdf-outline", placed: outline };
    const toc = structure.epubToc ? placeToc(text, structure.epubToc) : [];
    if (toc.length >= MIN_ENTRIES) return { source: "epub-toc", placed: toc };
    // The text detectors alone: an outline or TOC that did not place is no better here.
    const chapters = detectChapters(text).chapters.map((c) => ({ title: c.heading, level: 1, start: c.startChar }));
    return chapters.length > 0 ? { source: "chapters", placed: chapters } : null;
  };
  const picked = pick();
  if (!picked) return { source: null, sections: [] };
  const spans = nest(text.length, inOrder(picked.placed));
  for (const s of spans) s.matterKind = majorityKind(s, chunks, kinds);
  return { source: picked.source, sections: spans };
}

/** Outline entries → offsets: the entry's page start, snapped to its title line on that page. */
function placeOutline(text: string, entries: readonly OutlineEntry[]): Placed[] {
  const pages = scanPageStarts(text);
  if (pages.length < 2) return []; // no page breaks to map onto
  const out: Placed[] = [];
  for (const e of entries) {
    if (e.page === null || e.page < 1 || e.page > pages.length || e.level > MAX_SECTION_LEVEL) continue;
    const pageStart = pages[e.page - 1]!;
    const pageEnd = e.page < pages.length ? pages[e.page]! : text.length;
    out.push({ title: e.title, level: e.level, start: snap(text, out, { from: pageStart, end: pageEnd }, e.title) });
  }
  return out;
}

/** TOC entries → offsets: the spine-doc anchor; a #fragment entry snaps to its title line in that doc. */
function placeToc(text: string, toc: EpubToc): Placed[] {
  const docIndex = new Map(toc.anchors.map((a, i) => [a.href, i]));
  const out: Placed[] = [];
  for (const e of toc.entries) {
    const di = docIndex.get(e.href);
    if (di === undefined || e.level > MAX_SECTION_LEVEL) continue; // doc not anchored in the text
    const docStart = toc.anchors[di]!.start;
    const docEnd = di + 1 < toc.anchors.length ? toc.anchors[di + 1]!.start : text.length;
    const start = e.fragment ? snap(text, out, { from: docStart, end: docEnd }, e.title) : docStart;
    out.push({ title: e.title, level: e.level, start });
  }
  return out;
}

/** The title line in [from, end), searched past the previous entry so two can't share a line. */
function snap(text: string, prev: readonly Placed[], range: { from: number; end: number }, title: string): number {
  const { from, end } = range;
  const last = prev[prev.length - 1];
  const after = last && last.start >= from && last.start < end ? last.start + 1 : from;
  return (after < end ? findTitleLine(text, after, end, title) : null) ?? from;
}

/**
 * Entries in document order with clean titles: an entry that starts before the previous one is
 * dropped, and so is one at the same offset unless it is deeper (a part and its first chapter
 * on one page). Untitled entries are dropped.
 */
function inOrder(placed: readonly Placed[]): Placed[] {
  const kept: Placed[] = [];
  for (const p of placed) {
    const title = cleanTitle(p.title);
    const prev = kept[kept.length - 1];
    if (!title || (prev && (p.start < prev.start || (p.start === prev.start && p.level <= prev.level)))) continue;
    kept.push({ ...p, title });
  }
  return kept;
}

function cleanTitle(raw: string): string {
  const t = raw
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > MAX_SECTION_TITLE ? t.slice(0, MAX_SECTION_TITLE).trimEnd() : t;
}

/** Flat leveled starts → nested spans; a span ends where the next one at its level or above starts. */
function nest(textLength: number, items: readonly Placed[]): SectionSpan[] {
  const out: SectionSpan[] = [];
  const open: number[] = [];
  for (const it of items) {
    while (open.length > 0 && out[open[open.length - 1]!]!.level >= it.level) out[open.pop()!]!.charEnd = it.start;
    out.push({
      title: it.title,
      level: it.level,
      charStart: it.start,
      charEnd: textLength,
      parent: open.length > 0 ? open[open.length - 1]! : null,
      matterKind: BODY_KIND,
    });
    open.push(out.length - 1);
  }
  return out;
}

/**
 * The matter kind covering most of the span's characters, from the chunks' kinds. Classifying a
 * whole section with `classifyChunk` would misfire: its prose guard and legal-wording test are
 * tuned for chunk-sized text. Ties go to the earlier kind in MATTER_KINDS (body first).
 */
function majorityKind(span: ChunkRange, chunks: readonly ChunkRange[], kinds: readonly MatterKind[]): MatterKind {
  const chars = new Map<MatterKind, number>();
  // Chunks are sorted by start: skip to the first one that ends past the span start.
  let lo = 0;
  let hi = chunks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chunks[mid]!.charEnd <= span.charStart) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < chunks.length && chunks[i]!.charStart < span.charEnd; i++) {
    const c = chunks[i]!;
    const overlap = Math.min(c.charEnd, span.charEnd) - Math.max(c.charStart, span.charStart);
    const kind = kinds[i] ?? BODY_KIND;
    if (overlap > 0) chars.set(kind, (chars.get(kind) ?? 0) + overlap);
  }
  // No overlapping chunk (a span past a truncated or unchunked tail) means no evidence; body is
  // the classifier's own default, so such a span is labelled like ordinary text.
  let best: MatterKind = BODY_KIND;
  let bestChars = 0;
  for (const k of MATTER_KINDS) {
    const n = chars.get(k) ?? 0;
    if (n > bestChars) [best, bestChars] = [k, n];
  }
  return best;
}

/**
 * The section path at `offset`: every span with `charStart <= offset < charEnd`, top level
 * first, ending at the deepest one. [] when no span holds the offset. Spans nest, so the spans
 * that hold an offset are exactly the deepest one's ancestor chain.
 */
export function sectionPathAt<T extends { charStart: number; charEnd: number; parent: number | null }>(
  sections: readonly T[],
  offset: number,
): T[] {
  let deepest = -1;
  for (let i = 0; i < sections.length && sections[i]!.charStart <= offset; i++) {
    if (offset < sections[i]!.charEnd) deepest = i;
  }
  const path: T[] = [];
  for (let i: number | null = deepest < 0 ? null : deepest; i !== null; i = sections[i]!.parent) {
    path.unshift(sections[i]!);
  }
  return path;
}
