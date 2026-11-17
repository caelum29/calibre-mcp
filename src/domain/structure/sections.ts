// Section spans of a book's extracted text, with level, title and parent, and the section path
// at an offset (#620 spike, never merged). Precedence: PDF outline (all levels) or EPUB TOC,
// else the text chapter detectors plus Markdown ATX headings below a chapter. Front matter gets
// no path segment, so a contents page never becomes "[Book › contents]". Pure and SDK-free.

import { scanPageStarts } from "../page-offsets.js";
import { chapterNumber, detectChapters } from "./chapters.js";
import type { EpubToc } from "./epub-toc.js";
import { isFrontMatterTitle } from "./front-matter-titles.js";
import { findTitleLine, PART_TITLE, pickChapterLevel, type OutlineEntry } from "./pdf-outline.js";

/** One section of the book text. */
export interface SectionSpan {
  title: string;
  /** Nesting depth, 1 = top level. */
  level: number;
  /** Char offset of the section start (its heading line when found). */
  start: number;
  /** Start of the next section at the same or a higher level (text end for the last). */
  end: number;
  /** Index of the parent section in the same array, null at top level. */
  parent: number | null;
  /** True for the level that holds the book's chapters (the chapter-map rule). */
  chapter: boolean;
  /** Front matter (cover, contents, preface…) and its children: never a path segment. */
  frontMatter: boolean;
}

/** All sections of one book, in document order, and where they came from. */
export interface BookSections {
  source: "pdf-outline" | "epub-toc" | "chapters" | "none";
  sections: SectionSpan[];
}

/** Deepest outline / TOC level read; deeper entries are sub-sub-sections nobody searches by. */
const MAX_SECTION_LEVEL = 4;
/** Each path title is cut to this many characters (issue #620: "each title cut to 80"). */
export const MAX_PATH_TITLE = 80;

interface Resolved {
  title: string;
  level: number;
  start: number;
}

/**
 * Sections of `text` from its PDF outline or EPUB TOC, else from the chapter detectors.
 * `markdown` = the text is ebook-convert Markdown (EPUB), so ATX headings give sub-levels.
 */
export function bookSections(
  text: string,
  src: { outline?: OutlineEntry[]; epubToc?: EpubToc | null; markdown?: boolean },
): BookSections {
  if (src.outline && src.outline.length > 0) {
    const s = buildSections(text, resolveOutline(text, src.outline), (e) => PART_TITLE.test(e.title));
    if (s) return { source: "pdf-outline", sections: s };
  }
  if (src.epubToc && src.epubToc.entries.length > 0) {
    const s = buildSections(
      text,
      resolveToc(text, src.epubToc),
      (e, kids) => PART_TITLE.test(e.title) || kids.filter((k) => chapterNumber(k.title) !== null).length >= 2,
    );
    if (s) return { source: "epub-toc", sections: s };
  }
  const fallback = chapterSections(text, src.markdown ?? false);
  return fallback.length > 0 ? { source: "chapters", sections: fallback } : { source: "none", sections: [] };
}

/** Outline entries → offsets: page start, snapped to the title line on that page. */
function resolveOutline(text: string, entries: OutlineEntry[]): Resolved[] {
  const pages = scanPageStarts(text);
  if (pages.length < 2) return []; // no page breaks to map onto
  const out: Resolved[] = [];
  for (const e of entries) {
    if (e.page === null || e.page > pages.length || e.level > MAX_SECTION_LEVEL) continue;
    const pageStart = pages[e.page - 1]!;
    const pageEnd = e.page < pages.length ? pages[e.page]! : text.length;
    // Two entries on one page: search past the previous heading so they can't share a line.
    const prev = out[out.length - 1];
    const from = prev && prev.start >= pageStart && prev.start < pageEnd ? prev.start + 1 : pageStart;
    const start = findTitleLine(text, from, pageEnd, e.title) ?? pageStart;
    out.push({ title: e.title, level: e.level, start });
  }
  return out;
}

/** TOC entries → offsets: spine-doc anchor, a #fragment snapped to its title line in that doc. */
function resolveToc(text: string, toc: EpubToc): Resolved[] {
  const docIndex = new Map(toc.anchors.map((a, i) => [a.href, i]));
  const out: Resolved[] = [];
  for (const e of toc.entries) {
    const di = docIndex.get(e.href);
    if (di === undefined || e.level > MAX_SECTION_LEVEL) continue;
    const docStart = toc.anchors[di]!.start;
    const docEnd = di + 1 < toc.anchors.length ? toc.anchors[di + 1]!.start : text.length;
    let start = docStart;
    if (e.fragment) {
      const prev = out[out.length - 1];
      const from = prev && prev.start >= docStart ? prev.start + 1 : docStart;
      start = (from < docEnd ? findTitleLine(text, from, docEnd, e.title) : null) ?? docStart;
    }
    out.push({ title: e.title, level: e.level, start });
  }
  return out;
}

/**
 * Resolved entries → section spans: out-of-order entries dropped, front matter marked (every
 * front-matter title, the book-title stub right before one (#625), and their children), the
 * chapter level picked by the chapter-map rule. Null when < 2 body sections remain.
 */
function buildSections(
  text: string,
  resolved: Resolved[],
  isPart: (e: Resolved, kids: Resolved[]) => boolean,
): SectionSpan[] | null {
  const kept: Resolved[] = [];
  for (const r of resolved) {
    const prev = kept[kept.length - 1];
    // Same offset is fine only for a deeper entry (a part heading and its first chapter on one page).
    if (prev && (r.start < prev.start || (r.start === prev.start && r.level <= prev.level))) continue;
    kept.push(r);
  }
  const chapters = new Set(pickChapterLevel(kept, isPart));
  const fmStub = kept.length > 1 && !isFrontMatterTitle(kept[0]!.title) && isFrontMatterTitle(kept[1]!.title);
  const sections = spansFromLevels(text, kept, (r, i) => ({
    chapter: chapters.has(r),
    frontMatter: isFrontMatterTitle(r.title) || (i === 0 && fmStub && !/^\s*\d/.test(r.title)),
  }));
  return sections.filter((s) => !s.frontMatter).length >= 2 ? sections : null;
}

/** Nest flat leveled starts into spans; front matter is inherited by children. */
function spansFromLevels<T extends { title: string; level: number; start: number }>(
  text: string,
  items: T[],
  flags: (item: T, i: number) => { chapter: boolean; frontMatter: boolean },
): SectionSpan[] {
  const out: SectionSpan[] = [];
  const stack: number[] = [];
  items.forEach((it, i) => {
    while (stack.length > 0 && out[stack[stack.length - 1]!]!.level >= it.level) {
      out[stack.pop()!]!.end = it.start;
    }
    const parent = stack.length > 0 ? stack[stack.length - 1]! : null;
    const f = flags(it, i);
    out.push({
      title: it.title.replace(/\s+/g, " ").trim(),
      level: it.level,
      start: it.start,
      end: text.length,
      parent,
      chapter: f.chapter,
      frontMatter: f.frontMatter || (parent !== null && out[parent]!.frontMatter),
    });
    stack.push(out.length - 1);
  });
  return out;
}

const ATX = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** No outline / TOC: detected chapters as level 1, deeper ATX headings inside each as levels 2–3. */
function chapterSections(text: string, markdown: boolean): SectionSpan[] {
  const { chapters } = detectChapters(text);
  const items: { title: string; level: number; start: number; chapter: boolean }[] = [];
  for (const c of chapters) {
    items.push({ title: c.heading.replace(/^#+\s*/, ""), level: 1, start: c.startChar, chapter: true });
    if (!markdown) continue;
    const own = ATX.exec(c.heading)?.[1]?.length ?? 1;
    let inFence = false;
    let pos = text.indexOf("\n", c.startChar) + 1;
    while (pos > 0 && pos < c.endChar) {
      const nl = text.indexOf("\n", pos);
      const lineEnd = nl === -1 || nl > c.endChar ? c.endChar : nl;
      const line = text.slice(pos, lineEnd);
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      const m = inFence ? null : ATX.exec(line);
      const depth = m ? m[1]!.length - own : 0;
      if (m && depth >= 1 && depth <= 2) items.push({ title: m[2]!, level: 1 + depth, start: pos, chapter: false });
      pos = lineEnd + 1;
    }
  }
  return spansFromLevels(text, items, (it) => ({ chapter: it.chapter, frontMatter: isFrontMatterTitle(it.title) }));
}

/**
 * Section path at `offset`: [chapter, deepest section] (the section only when deeper than the
 * chapter), each cut to 80 chars; [] inside front matter or outside every body section. Parts
 * above the chapter are skipped: the prefix holds at most title, chapter and deepest section.
 */
export function sectionPathAt(sections: SectionSpan[], offset: number): string[] {
  let deepest = -1;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    if (s.start > offset) break;
    if (offset < s.end && !s.frontMatter) deepest = i;
  }
  if (deepest < 0) return [];
  const chain: number[] = [];
  for (let i: number | null = deepest; i !== null; i = sections[i]!.parent) chain.unshift(i);
  const body = chain.filter((i) => !sections[i]!.frontMatter);
  if (body.length === 0) return [];
  const chapterAt = [...body].reverse().find((i) => sections[i]!.chapter) ?? body[0]!;
  const path = [sections[chapterAt]!.title];
  if (deepest !== chapterAt && sections[deepest]!.level > sections[chapterAt]!.level) {
    path.push(sections[deepest]!.title);
  }
  return path.map((t) => (t.length > MAX_PATH_TITLE ? t.slice(0, MAX_PATH_TITLE).trimEnd() : t));
}

/** Starts of the body sections after offset 0, ascending and unique: arm 2's forced chunk breaks. */
export function sectionStarts(sections: SectionSpan[]): number[] {
  return [...new Set(sections.filter((s) => !s.frontMatter && s.start > 0).map((s) => s.start))].sort((a, b) => a - b);
}

/** "[title › chapter › section]\n" — the arm-1 embedding prefix; null when the path is empty. */
export function sectionPrefix(title: string, path: string[]): string | null {
  if (path.length === 0) return null;
  const t = title.length > MAX_PATH_TITLE ? title.slice(0, MAX_PATH_TITLE).trimEnd() : title;
  return `[${[t, ...path].join(" › ")}]\n`;
}
