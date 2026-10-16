// PDF outline (bookmarks) → chapter spans (#134). Publisher outlines carry exact chapter
// pages even when the body text never says "Chapter N" — the only structure signal for many
// RU/UK books. Pure and SDK-free: the XML comes from poppler's `pdftohtml -xml` (see
// src/calibre/pdf-outline.ts); pages map to char offsets via the text's `\f` page breaks.

import { scanPageStarts } from "../page-offsets.js";
import type { ChapterSpan } from "./chapters.js";

/** One outline (bookmark) entry. */
export interface OutlineEntry {
  title: string;
  /** 1-based target page; null when the bookmark's destination didn't resolve to a page. */
  page: number | null;
  /** Nesting depth, 1 = top level. */
  level: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Parse the `<outline>` tree of `pdftohtml -xml` output into flat, document-order entries.
 * Tolerant by design — no outline, garbage, or truncated XML yields what could be read
 * (possibly []), never a throw: a broken outline must degrade to the text detectors.
 */
export function parsePdfOutlineXml(xml: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  let depth = 0;
  const TOKEN = /<outline\b[^>]*?(\/?)>|<\/outline\s*>|<item\b([^>]*)>([\s\S]*?)<\/item\s*>/g;
  for (const m of xml.matchAll(TOKEN)) {
    const tok = m[0];
    if (tok.startsWith("</")) {
      depth = Math.max(0, depth - 1);
    } else if (tok.startsWith("<outline")) {
      if (m[1] !== "/") depth++; // <outline/> is an empty subtree
    } else if (depth > 0) {
      const pageAttr = /\bpage\s*=\s*"(\d+)"/.exec(m[2] ?? "");
      const page = pageAttr ? Number(pageAttr[1]) : null;
      const title = decodeEntities((m[3] ?? "").replace(/<[^>]*>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
      if (title) out.push({ title, page: page !== null && page >= 1 ? page : null, level: depth });
    }
  }
  return out;
}

// Leading front-matter bookmarks (EN + RU/UK). Matched as a whole normalized title, or as a
// prefix for the "About the …" family. Only a LEADING run is dropped — the same rule the text
// detector follows (text before the first chapter is front matter, not a span) — so a
// mid-book "Preface to Part II" stays.
const FRONT_MATTER = new RegExp(
  "^(?:" +
    [
      "cover",
      "front cover",
      "title",
      "title page",
      "half title",
      "copyright",
      "copyright page",
      "copyright and credits",
      "credits",
      "dedication",
      "epigraph",
      "contents",
      "table of contents",
      "brief contents",
      "contents at a glance",
      "toc",
      "praise",
      "praise for.*",
      "endorsements",
      "forewords?(?: .*)?",
      "preface(?: .*)?",
      "acknowledgments?",
      "acknowledgements?",
      "contributors",
      "about the authors?.*",
      "about the (?:technical )?reviewers?.*",
      "about this book",
      "about the cover.*",
      "who this book is for",
      "list of (?:figures|tables)",
      "packt.*",
      "обложка",
      "титул",
      "титульный лист",
      "оглавление",
      "содержание",
      "зміст",
      "предисловие.*",
      "передмова.*",
      "благодарности",
      "подяки",
      "об автор.*",
      "про автор.*",
      "об этой книге",
      "о книге",
      "про книгу",
      "отзывы.*",
      "відгуки.*",
      "о научн\\S* редактор.*",
      "о рецензент.*",
      "от издательства",
      "від видавництва",
      "посвящение",
      "присвята",
    ].join("|") +
    ")$",
  "u",
);

function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when an outline title names a front-matter section (cover, copyright, preface…). */
export function isFrontMatterTitle(title: string): boolean {
  return FRONT_MATTER.test(norm(title));
}

// A chapter list denser than this is not a chapter list: flat outlines that bookmark every
// section (#134 measured 447 and 238 top-level entries) or one entry per page (a scanner's
// "000, 002, 003…" page bookmarks).
const MAX_CHAPTERS = 150;
const MAX_ENTRIES_PER_PAGE = 0.5;
// Fewer top-level body entries than this means the top level is a wrapper, not chapters: a
// single "Book Title" root, or 2–3 unlabeled parts ("Setup" / "Fundamentals" / "Advanced").
const MIN_TOP_LEVEL = 4;
// Deepest level ever expanded into; deeper bookmarks are subsections in every book measured.
const MAX_LEVEL = 3;

// "Part I", "Part 2: …", "Часть 1.", "Частина II".
const PART_TITLE = /^\s*(?:part|часть|частина)\s+(?:[IVXLC]+|\d+)\b/i;

interface OutlineNode {
  entry: OutlineEntry;
  children: OutlineNode[];
}

/** Rebuild the bookmark tree from flat document-order entries (level jumps tolerated). */
function buildTree(entries: OutlineEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const entry of entries) {
    const node: OutlineNode = { entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.entry.level >= entry.level) stack.pop();
    (stack.length > 0 ? stack[stack.length - 1]!.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

function dropLeadingFrontMatter<T>(items: T[], title: (t: T) => string): T[] {
  let i = 0;
  while (i < items.length && isFrontMatterTitle(title(items[i]!))) i++;
  return items.slice(i);
}

/** Replace each node with its children when `expand` says so (childless nodes stay). */
function expandWhere(nodes: OutlineNode[], expand: (n: OutlineNode) => boolean): OutlineNode[] {
  return nodes.flatMap((n) => (n.children.length > 0 && expand(n) ? n.children : [n]));
}

/**
 * Pick the outline entries that are the book's chapters, or null when no plausible list exists.
 *
 * Rule (documented in docs/SEMANTIC-SEARCH.md):
 * 1. Start from the top level; drop its leading front matter (cover, copyright, preface…).
 * 2. Expand "Part N" / "Часть N" entries into their children, so a top level mixing parts
 *    and chapters ("Chapter 1, Part I, Part II") yields chapters throughout.
 * 3. While fewer than 4 body entries remain (a single book-title root, or 2–3 unlabeled
 *    parts), replace every entry by its children — never below level 3.
 * 4. Reject the result when < 2 entries have pages, or it is implausibly dense
 *    (> 150 entries, or more than one per two pages — flat "every section" outlines).
 */
export function selectChapterEntries(entries: OutlineEntry[], pageCount: number): OutlineEntry[] | null {
  const dropFm = (ns: OutlineNode[]) => dropLeadingFrontMatter(ns, (n) => n.entry.title);
  let nodes = dropFm(expandWhere(dropFm(buildTree(entries)), (n) => PART_TITLE.test(n.entry.title)));
  while (nodes.length < MIN_TOP_LEVEL) {
    const next = expandWhere(nodes, (n) => n.entry.level < MAX_LEVEL);
    if (next.length === nodes.length) break; // nothing (left) to expand into
    nodes = dropFm(next);
  }

  const picked = nodes.map((n) => n.entry).filter((e) => e.page !== null);
  const maxCount = Math.min(MAX_CHAPTERS, pageCount > 0 ? Math.max(2, pageCount * MAX_ENTRIES_PER_PAGE) : MAX_CHAPTERS);
  if (picked.length < 2 || picked.length > maxCount) return null;
  return picked;
}

/**
 * Snap a page-start offset to the heading line on that page: a page start is up to a page
 * of running header/footer away from the real heading. Looks for the first line on the page
 * whose letters-and-digits form is a prefix of the title (a wrapped "Chapter 1" line above
 * its title counts) or contains the whole title; falls back to the page start.
 */
function snapToTitle(text: string, pageStart: number, pageEnd: number, title: string): number {
  const want = norm(title);
  if (!want) return pageStart;
  let lineStart = pageStart;
  while (lineStart < pageEnd) {
    let nl = text.indexOf("\n", lineStart);
    if (nl === -1 || nl > pageEnd) nl = pageEnd;
    const line = norm(text.slice(lineStart, nl));
    // Prefix match needs some substance so a stray "1" or "a" line doesn't snap.
    if (line && ((line.length >= Math.min(6, want.length) && want.startsWith(line)) || line.startsWith(want))) {
      return lineStart;
    }
    lineStart = nl + 1;
  }
  return pageStart;
}

/**
 * Map a PDF outline onto chapter spans over the extracted text, or null when the outline
 * is unusable (no plausible chapter level, or < 2 entries survive page mapping) — the
 * caller then falls back to the text detectors. `n` is a 1-based ordinal (outlines carry
 * titles, not chapter numbers); leading front matter is excluded, as in the text detector.
 */
export function outlineChapters(text: string, entries: OutlineEntry[]): ChapterSpan[] | null {
  const pageStarts = scanPageStarts(text);
  // One page and no \f: the text has no page breaks to map onto (e.g. an ebook-convert
  // fallback) — every entry would collapse onto offset 0.
  if (pageStarts.length < 2) return null;
  const picked = selectChapterEntries(entries, pageStarts.length);
  if (picked === null) return null;

  const starts: { heading: string; startChar: number }[] = [];
  for (const e of picked) {
    const p = e.page!;
    if (p > pageStarts.length) continue; // bookmark past the text's last page
    const pageStart = pageStarts[p - 1]!;
    const pageEnd = p < pageStarts.length ? pageStarts[p]! : text.length;
    const startChar = snapToTitle(text, pageStart, pageEnd, e.title);
    const prev = starts[starts.length - 1];
    // Out-of-order or same-offset bookmarks would yield empty/negative spans — drop them.
    if (prev && startChar <= prev.startChar) continue;
    starts.push({ heading: e.title, startChar });
  }
  if (starts.length < 2) return null;

  return starts.map((s, i) => ({
    n: i + 1,
    heading: s.heading,
    startChar: s.startChar,
    endChar: i + 1 < starts.length ? starts[i + 1]!.startChar : text.length,
  }));
}
