// Front-matter boundary for semantic-search demotion (D-016, #18): where a book's body
// starts. The chapter detector's first chapter covers plain-text/PDF books; EPUB
// conversions render title page, copyright, praise and TOC as Markdown headings, so the
// detector sees a "chapter" at char 0 — the leading-heading rules below cover those (#102).

import { chapterNumber, detectChapters, type DetectOptions } from "./chapters.js";

/** Where the leading front matter ends, and which rule decided it. */
export interface LeadingFrontMatter {
  /** Char offset of the first body heading; 0 = no front matter claimed. */
  end: number;
  /** "anchor" = first-chapter heading; "run" = leading run of short/front-matter sections. */
  rule: "anchor" | "run" | "none";
  /** The heading the body starts at (for evidence/debugging). */
  heading?: string;
}

// A "first chapter" deeper than this is more likely a detector miss than real front matter;
// claiming 20%+ of a book as front matter would demote genuine body content in search.
export const FM_MAX_FRACTION = 0.2;
export const FM_MAX_CHARS = 60_000;
// A section this short (heading to next heading) is a title page, copyright or
// revision-history stub, not body content — real chapter sections run thousands of chars.
export const FM_SHORT_SECTION_CHARS = 2_500;
// The run rule only applies to heading-first texts (EPUB→Markdown conversions): the first
// heading must sit this close to the start. PDF text has no headings, and the "# ..."
// lines it does have are code comments deep in the body.
export const FM_FIRST_HEADING_MAX_CHARS = 1_500;
// The leading run never spans more sections than this (a TOC rendered as headings can be
// long, but past this we are inside the body).
export const FM_MAX_RUN_SECTIONS = 40;

// Heading titles that are front matter by name, EN + RU/UK. Whole-title match after
// decoration stripping, so "Preface" matches but "Prefaces in Kotlin" does not.
const FRONT_MATTER_TITLES = [
  // EN: title/legal/praise/TOC
  "praise",
  "praise for .*",
  "advance praise.*",
  "what (?:people|readers|others) are saying.*",
  "copyright",
  "copyright page",
  "dedication",
  "epigraph",
  "title page",
  "half title",
  "inside front cover",
  "front matter",
  "also by .*",
  "other books .*",
  "books by .*",
  "contents",
  "table of contents",
  "brief contents",
  "contents in detail",
  "brief table of contents.*",
  "revision history.*",
  "colophon",
  // EN: foreword/preface and the publisher-boilerplate preface sections
  "foreword(?: (?:to|by) .*)?",
  "preface(?: to .*)?",
  "author['’]?s note",
  "a note .*",
  "welcome",
  "acknowledg(?:e)?ments?",
  "about the authors?",
  "about the (?:technical )?reviewers?",
  "about the contributors?",
  "contributors",
  "about this book",
  "about the cover.*",
  "who (?:this book is for|should read this book).*",
  "what you will learn",
  "how to (?:read|use) this book",
  "how this book is organized.*",
  "conventions(?: used)?(?: in this book)?",
  "using code examples",
  "o['’]reilly (?:online learning|safari)",
  "safari.*",
  "how to contact us",
  "errata",
  "submitting errata",
  "get in touch",
  "download the example code files?",
  "why i wrote this book",
  "liveBook discussion forum",
  "author online",
  "early praise.*",
  "who is this book for\\??",
  "what['’]s in (?:this|the) book\\??",
  "a note about the code",
  "online resources",
  // EN: Packt/BPB preface boilerplate
  "why subscribe\\??",
  "packt\\.com",
  "(?:www\\.)?packtpub\\.com",
  "packt is searching for authors like you",
  "credits",
  "customer feedback",
  "customer support",
  "reader feedback",
  "what you need for this book",
  "what this book covers",
  "(?:to get|getting) the most out of this book",
  "downloading the code",
  "download(?:ing)? the (?:example code(?: files)?|colou?r images)",
  "code bundle.*",
  "colou?red images",
  "piracy",
  "questions",
  "reviews",
  "share your thoughts",
  "acknowledgement",
  // RU/UK
  "предисловие(?: .*)?",
  "от автора",
  "от издательства",
  "об автор(?:е|ах)",
  "о книге",
  "об этой книге",
  "оглавление",
  "содержание",
  "краткое содержание",
  "благодарности",
  "посвящение",
  "отзывы.*",
  "для кого эта книга",
  "условные обозначения",
  "о научном редакторе",
  "о рецензент(?:е|ах)",
  "передмова",
  "зміст",
  "подяки",
  "про автора",
  "про авторів",
  "про книгу",
];
const FRONT_MATTER_TITLE = new RegExp(`^(?:${FRONT_MATTER_TITLES.join("|")})$`, "iu");

const ATX = /^(#{1,6})\s+(.+?)\s*#*$/;

interface Heading {
  depth: number;
  title: string;
  start: number;
}

/** Strip Markdown emphasis/escapes that EPUB→Markdown conversion wraps headings in. */
export function cleanHeading(raw: string): string {
  return raw
    .replace(/\\(.)/g, "$1")
    .replace(/[*_]+/g, " ") // "CHAPTER 1**Routing**" → "CHAPTER 1 Routing"
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\[\s*(.*?)\s*\]$/, "$1"); // "[ 1 ]" chapter-number boxes
}

/** ATX headings with offsets, fence-aware. */
function scanHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i !== text.length && text[i] !== "\n") continue;
    const line = text.slice(start, i).trim();
    if (line.startsWith("```") || line.startsWith("~~~")) inFence = !inFence;
    else if (!inFence) {
      const m = ATX.exec(line);
      if (m) {
        const title = cleanHeading(m[2]!);
        if (/\p{L}|\d/u.test(title)) out.push({ depth: m[1]!.length, title, start });
      }
    }
    start = i + 1;
  }
  return out;
}

/**
 * Chapter number of a first-chapter-shaped heading: "Chapter 1. X", "Глава 1", "Part I",
 * "1 Meeting Postgres", "1. Promise Basics", a bare "1". Sub-numbering ("1.1 X") is not.
 */
export function anchorNumber(title: string): number | null {
  // "Part I" / "Part 1: Introduction" — chapterNumber knows Часть/Частина but not "Part".
  const part = /^(?:part|часть|частина)\s+(\d{1,2}|[ivx]{1,4})\b/i.exec(title);
  if (part)
    return /^\d/.test(part[1]!)
      ? Number(part[1])
      : (({ i: 1, ii: 2, iii: 3, iv: 4 } as Record<string, number>)[part[1]!.toLowerCase()] ?? null);
  const n = chapterNumber(title);
  if (n !== null) return n;
  if (/^\d{1,2}\.\d/.test(title)) return null;
  const m = /^(\d{1,2})(?:[.:]?\s+\S.*|[.:]?)$/u.exec(title);
  if (!m) return null;
  // A numeric title must look like a heading, not a list item or a page number line.
  return title.length <= 80 ? Number(m[1]) : null;
}

/** Front-matter-by-name test on a cleaned heading title. */
export function isFrontMatterTitle(title: string): boolean {
  return FRONT_MATTER_TITLE.test(title.replace(/[.:]+$/, "").trim());
}

/**
 * Find where heading-structured front matter ends.
 *
 * 1. Anchor: the first chapter-1 heading (decoration-stripped). When it recurs (a TOC
 *    rendered as headings), take the occurrence with the longest distance to the next
 *    chapter-2 heading — the TOC copy sits right before its siblings.
 * 2. Run (heading-first texts only): otherwise walk the leading sections. Short unnamed
 *    sections (< FM_SHORT_SECTION_CHARS) before any named one are title-page stubs;
 *    sections whose title names front matter (EN/RU/UK list) absorb their subsections;
 *    the body starts at the first unnamed section after a named one, or the first long one.
 *
 * Either boundary deeper than min(FM_MAX_FRACTION, FM_MAX_CHARS) is rejected (returns 0).
 */
export function leadingFrontMatter(text: string): LeadingFrontMatter {
  const cap = Math.min(FM_MAX_FRACTION * text.length, FM_MAX_CHARS);
  const hs = scanHeadings(text);
  if (hs.length === 0) return { end: 0, rule: "none" };

  // 1. Anchor.
  // Only within the cap: a numbered step "1" deep in the body is not the first chapter.
  const ones = hs.filter((h) => h.start <= cap && anchorNumber(h.title) === 1);
  const twos = hs.filter((h) => anchorNumber(h.title) === 2);
  const gap = (h: Heading) => (twos.find((t) => t.start > h.start)?.start ?? text.length) - h.start;
  const best = ones.length > 0 ? ones.reduce((a, b) => (gap(b) > gap(a) ? b : a)) : undefined;
  // A real first chapter runs thousands of chars to chapter 2; a TOC entry or a numbered
  // list item ("**1.** **Transaction Support**") does not.
  if (best && gap(best) >= FM_SHORT_SECTION_CHARS) {
    // Part I precedes Chapter 1: start the body at the part heading.
    const part = hs
      .filter((h) => h.start < best.start && /^(?:part|часть|частина)\b/i.test(h.title) && anchorNumber(h.title) === 1)
      .pop();
    const anchor = part && best.start - part.start < FM_SHORT_SECTION_CHARS ? part : best;
    if (anchor.start > 0) return { end: anchor.start, rule: "anchor", heading: anchor.title };
  }

  if (hs[0]!.start > FM_FIRST_HEADING_MAX_CHARS) return { end: 0, rule: "none" };

  // 2. Run: short unnamed sections (title page, half-title) lead, named front matter
  // follows; the body starts at the first unnamed section after a named one, or at the
  // first long unnamed section. Chapter openers can be short too ("Introducing Rust", 600
  // chars before its first subsection), so length alone never extends a run past named FM.
  let seenNamed = false;
  for (let i = 0; i < hs.length && i < FM_MAX_RUN_SECTIONS; i++) {
    const h = hs[i]!;
    // A section runs to the next heading at the same or a shallower depth.
    const next = hs.slice(i + 1).find((x) => x.depth <= h.depth);
    const len = (next?.start ?? text.length) - h.start;
    if (isFrontMatterTitle(h.title)) {
      seenNamed = true;
      // Named front matter absorbs its deeper subsections.
      i = next ? hs.indexOf(next) - 1 : hs.length;
      continue;
    }
    if (!seenNamed && len < FM_SHORT_SECTION_CHARS) continue;
    if (h.start === 0) return { end: 0, rule: "none" };
    return h.start <= cap ? { end: h.start, rule: "run", heading: h.title } : { end: 0, rule: "none" };
  }
  return { end: 0, rule: "none" };
}

/**
 * Char offset where the book's body starts: everything before it (TOC, praise pages,
 * foreword, preface) is front matter. Takes the later of the first detected chapter
 * (PDF outline / numeric / structural) and the heading-structured boundary
 * (`leadingFrontMatter`, #102). Returns 0 — "no front matter claimed" — when neither
 * finds a plausible boundary (both are capped at min(FM_MAX_FRACTION, FM_MAX_CHARS)).
 * Powers the front-matter demotion in semantic search (issue #18).
 */
export function frontMatterEnd(text: string, opts: DetectOptions = {}): number {
  const { chapters } = detectChapters(text, opts);
  const cap = Math.min(FM_MAX_FRACTION * text.length, FM_MAX_CHARS);
  const first = chapters[0]?.startChar ?? 0;
  // A title-page heading at char ~0 is a "chapter" to the structural detector; the
  // heading rules only ever move the boundary later, never earlier.
  return Math.max(first > cap ? 0 : first, leadingFrontMatter(text).end);
}
