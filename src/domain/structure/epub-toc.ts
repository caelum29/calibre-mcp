// EPUB table of contents (nav.xhtml / NCX) → chapter spans (#135). The authored TOC names
// real chapters and points at real spine documents, but ebook-convert flattens the spine
// into one text blob. Instead of changing that text (every char offset of an indexed EPUB
// would shift), each spine document is located in the flat text by its own leading words
// ("anchoring"), and TOC hrefs resolve through those anchors. Pure and SDK-free — the zip
// IO lives in src/calibre/epub-toc.ts.

import { resolveHref } from "../figures/epub.js";
import type { ChapterSpan } from "./chapters.js";
import { decodeEntities, findTitleLine, MAX_CHAPTERS, PART_TITLE, pickChapterLevel } from "./pdf-outline.js";

/** One TOC entry, in document order. */
export interface TocEntry {
  title: string;
  /** Nesting depth, 1 = top level. */
  level: number;
  /** Zip-internal spine document href (fragment stripped). */
  href: string;
  /** `#fragment` target inside the document, when the entry has one. */
  fragment?: string;
}

/** Where a spine document starts in the extracted text (spine order, anchored docs only). */
export interface SpineAnchor {
  href: string;
  start: number;
}

/** What the extractor records for an EPUB: its TOC plus the spine anchors in the final text. */
export interface EpubToc {
  entries: TocEntry[];
  anchors: SpineAnchor[];
}

/** One spine document's HTML, spine order implied by array index. */
export interface SpineHtml {
  href: string;
  html: string;
}

/** TOC document locations named by the OPF — EPUB 3 nav and/or EPUB 2 NCX (zip-internal). */
export interface OpfTocRefs {
  nav?: string;
  ncx?: string;
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
    .exec(tag)
    ?.slice(1)
    .find((v) => v !== undefined);

/** Locate the TOC documents in the OPF manifest (nav by `properties="nav"`, NCX by spine `toc` or media type). */
export function parseOpfTocRefs(opfXml: string, opfPath: string): OpfTocRefs {
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const ncxId = attr(/<spine\b[^>]*>/i.exec(opfXml)?.[0] ?? "", "toc");
  const refs: OpfTocRefs = {};
  for (const m of opfXml.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const href = attr(tag, "href");
    if (!href) continue;
    const resolved = resolveHref(opfDir, safeDecode(href));
    if (!refs.nav && /(?:^|\s)nav(?:\s|$)/.test(attr(tag, "properties") ?? "")) refs.nav = resolved;
    if (!refs.ncx && (attr(tag, "id") === ncxId || attr(tag, "media-type") === "application/x-dtbncx+xml")) {
      refs.ncx = resolved;
    }
  }
  return refs;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Split a TOC href into a zip-internal doc path (relative to the TOC doc) + fragment. */
function splitHref(raw: string, tocDir: string): { href: string; fragment?: string } | null {
  const hash = raw.indexOf("#");
  const file = hash === -1 ? raw : raw.slice(0, hash);
  const fragment = hash === -1 ? "" : raw.slice(hash + 1);
  if (!file || /^[a-z][a-z0-9+.-]*:/i.test(file)) return null; // external link / in-TOC jump
  return { href: resolveHref(tocDir, safeDecode(file)), ...(fragment ? { fragment: safeDecode(fragment) } : {}) };
}

const cleanTitle = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * Parse an EPUB 3 nav document's `<nav epub:type="toc">` into flat entries. Level = `<ol>`
 * nesting depth. Tolerant: no toc nav, junk, or truncated markup yields what could be read.
 */
export function parseNavToc(xhtml: string, navPath: string): TocEntry[] {
  // The toc nav, not the landmarks/page-list navs that share the document.
  const navs = [...xhtml.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav\s*>/gi)];
  const toc = navs.find((m) => /\btype\s*=\s*["'][^"']*\btoc\b/i.test(m[1] ?? "")) ?? navs[0];
  if (!toc) return [];
  const dir = dirOf(navPath);
  const out: TocEntry[] = [];
  let depth = 0;
  const TOKEN = /<ol\b[^>]*>|<\/ol\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const m of (toc[2] ?? "").matchAll(TOKEN)) {
    const tok = m[0].toLowerCase();
    if (tok.startsWith("</ol")) depth = Math.max(0, depth - 1);
    else if (tok.startsWith("<ol")) depth++;
    else {
      const href = attr(m[1] ?? "", "href");
      const title = cleanTitle(m[2] ?? "");
      const target = href ? splitHref(href, dir) : null;
      if (title && target) out.push({ title, level: Math.max(1, depth), ...target });
    }
  }
  return out;
}

/**
 * Parse an EPUB 2 NCX `<navMap>` into flat entries. Level = `<navPoint>` nesting depth.
 * Tolerant like {@link parseNavToc}.
 */
export function parseNcxToc(xml: string, ncxPath: string): TocEntry[] {
  const map = /<navMap\b[^>]*>([\s\S]*?)(?:<\/navMap\s*>|$)/i.exec(xml)?.[1];
  if (!map) return [];
  const dir = dirOf(ncxPath);
  const out: TocEntry[] = [];
  let depth = 0;
  // A navPoint's own label + content precede its children, so open-tag order is document order.
  let pending: { level: number; title?: string } | null = null;
  const flush = () => (pending = null);
  const TOKEN = /<navPoint\b[^>]*>|<\/navPoint\s*>|<navLabel\b[^>]*>([\s\S]*?)<\/navLabel\s*>|<content\b([^>]*)>/gi;
  for (const m of map.matchAll(TOKEN)) {
    const tok = m[0].toLowerCase();
    if (tok.startsWith("</navpoint")) {
      depth = Math.max(0, depth - 1);
      flush();
    } else if (tok.startsWith("<navpoint")) {
      depth++;
      pending = { level: depth };
    } else if (tok.startsWith("<navlabel")) {
      if (pending && pending.title === undefined) {
        pending.title = cleanTitle(/<text\b[^>]*>([\s\S]*?)<\/text\s*>/i.exec(m[1] ?? "")?.[1] ?? "");
      }
    } else if (pending?.title) {
      const src = attr(m[2] ?? "", "src");
      const target = src ? splitHref(src, dir) : null;
      if (target) out.push({ title: pending.title, level: pending.level, ...target });
      flush();
    }
  }
  return out;
}

/** Prefer the EPUB 3 nav; fall back to the NCX when the nav is absent or yields nothing. */
export function pickToc(nav: TocEntry[], ncx: TocEntry[]): TocEntry[] {
  return nav.length > 0 ? nav : ncx;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
// Per-code-point fold results: a Cyrillic book repeats ~70 distinct letters a million times.
const FOLD_CACHE = new Map<string, string>();

/**
 * Letters+digits-only, lowercased, NFKC form of `text` plus a map from each kept char back
 * to its offset in `text`. Whitespace and markup differ between the spine HTML and the
 * converted Markdown (`\!` escapes, `**` emphasis, `#` headings); the letters do not.
 */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // ASCII fast path; everything else goes through NFKC + Unicode letter/number classes.
    if (code < 0x80) {
      if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) {
        folded += ch;
        map.push(i);
      } else if (code >= 65 && code <= 90) {
        folded += String.fromCharCode(code + 32);
        map.push(i);
      }
    } else {
      let f = FOLD_CACHE.get(ch);
      if (f === undefined) {
        f = [...ch.normalize("NFKC").toLowerCase()].filter((c) => LETTER_OR_DIGIT.test(c)).join("");
        FOLD_CACHE.set(ch, f);
      }
      for (let k = 0; k < f.length; k++) map.push(i);
      folded += f;
    }
    i += ch.length;
  }
  return { folded, map };
}

/** Visible body text of a spine document (head, scripts, styles and tags dropped). */
function bodyText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)/i.exec(html)?.[1] ?? html;
  return decodeEntities(
    body
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " "),
  );
}

// Probe = this many folded chars from a doc's start. Long enough that a chapter opening
// is not also a TOC line ("chapter1introduction" + body words), short enough to fit before
// an inline figure marker or footnote breaks the run.
const PROBE_CHARS = 48;
// A doc with less text than this (cover, image-only page) can't be told apart — skip it.
const MIN_PROBE_CHARS = 16;
// Later probe positions tried when the opening doesn't match (a figure marker or a heading
// the converter rendered differently sits there); the anchor then lands slightly late.
const PROBE_OFFSETS = [0, 48, 160];

/**
 * Locate each spine document's start in the extracted text, in spine order. A document is
 * found by its leading words, searched forward from the previous anchor so the TOC page or
 * an earlier cross-reference can't capture it. Docs that can't be found are left out —
 * TOC entries pointing at them then drop (or ride on a fragment-free neighbour).
 */
export function anchorSpineDocs(text: string, docs: SpineHtml[]): SpineAnchor[] {
  const { folded, map } = foldWithMap(text);
  const anchors: SpineAnchor[] = [];
  let from = 0;
  for (const doc of docs) {
    const probeSrc = foldWithMap(bodyText(doc.html)).folded;
    if (probeSrc.length < MIN_PROBE_CHARS) continue;
    for (const off of PROBE_OFFSETS) {
      if (off > 0 && off + MIN_PROBE_CHARS > probeSrc.length) break;
      const probe = probeSrc.slice(off, off + PROBE_CHARS);
      const at = folded.indexOf(probe, from);
      if (at === -1) continue;
      // Snap back to the line start so the anchor includes the heading's own "# " prefix.
      const start = lineStartAt(text, map[at]!);
      if (anchors.length === 0 || start > anchors[anchors.length - 1]!.start) {
        anchors.push({ href: doc.href, start });
      }
      from = at + probe.length;
      break;
    }
  }
  return anchors;
}

function lineStartAt(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** Recognizes a numbered chapter title ("Chapter 3", "Глава 3."); injected to keep this module cycle-free. */
export type ChapterTitleTest = (title: string) => boolean;

// An entry whose children include this many numbered chapters is a part wrapper, whatever
// its own title says ("Раздел I", "Book One", "I. Foundations") — EPUB TOCs nest chapters
// under parts far more often than PDF outlines do.
const MIN_NUMBERED_CHILDREN = 2;

/**
 * Map an EPUB TOC onto chapter spans over the extracted text, or null when unusable (no
 * plausible chapter level, or < 2 entries resolve) — the caller then falls back to the
 * text detectors. Chapter-level selection is the PDF-outline rule (leading front matter
 * dropped, parts expanded, wrapper levels descended), plus: any entry whose children are
 * numbered chapters (per `isChapterTitle`) is a part and expands too. An entry starts at its spine doc's
 * anchor; a `#fragment` entry snaps to its title line inside that doc and degrades to the
 * doc start when the title isn't found (then de-duplicated against its predecessor).
 */
export function epubTocChapters(
  text: string,
  toc: EpubToc,
  isChapterTitle: ChapterTitleTest = () => false,
): ChapterSpan[] | null {
  if (toc.anchors.length < 2) return null;
  const picked = pickChapterLevel(
    toc.entries,
    (e, kids) =>
      PART_TITLE.test(e.title) || kids.filter((k) => isChapterTitle(k.title)).length >= MIN_NUMBERED_CHILDREN,
  );
  const docIndex = new Map(toc.anchors.map((a, i) => [a.href, i]));

  const starts: { heading: string; startChar: number }[] = [];
  for (const e of picked) {
    const di = docIndex.get(e.href);
    if (di === undefined) continue; // points at a doc that wasn't anchored
    const docStart = toc.anchors[di]!.start;
    const docEnd = di + 1 < toc.anchors.length ? toc.anchors[di + 1]!.start : text.length;
    const prev = starts[starts.length - 1];
    let startChar = docStart;
    if (e.fragment) {
      // Mid-doc target: search past the previous chapter so two entries can't share a heading.
      const from = prev && prev.startChar >= docStart ? prev.startChar + 1 : docStart;
      startChar = (from < docEnd ? findTitleLine(text, from, docEnd, e.title) : null) ?? docStart;
    }
    if (prev && startChar <= prev.startChar) continue;
    starts.push({ heading: e.title, startChar });
  }
  if (starts.length < 2 || starts.length > MAX_CHAPTERS) return null;

  return starts.map((s, i) => ({
    n: i + 1,
    heading: s.heading,
    startChar: s.startChar,
    endChar: i + 1 < starts.length ? starts[i + 1]!.startChar : text.length,
  }));
}
