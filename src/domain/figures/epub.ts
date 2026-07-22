// EPUB figure inventory (D-018 / #78): walk spine HTML in reading order, pair
// <img>/<svg> with the adjacent caption element (figcaption, h6, or caption <p> —
// publishers vary; probe 2026-07-22: O'Reilly h6-in-figure, Packt p.IMG---Caption).
// Pure logic — unzipping and OPF discovery IO lives in src/calibre/figure-inventory.ts.

import { matchCaptionLine } from "./captions.js";
import type { FigureEntry, FigureInventory } from "./inventory.js";

/** One spine document, reading-order position implied by array index. */
export interface SpineDoc {
  /** Zip-internal href of the document (e.g. `text/part0010.html`). */
  href: string;
  html: string;
}

/** How far past an image tag to look for its caption. Captions are adjacent; a
 * window keeps a caption-less image from stealing the next figure's caption. */
const CAPTION_WINDOW = 2000;

// Tags whose closing marks the end of a caption candidate once text was seen.
const BLOCK_CLOSERS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "figcaption", "div", "figure", "caption", "li", "td"]);

/** Resolve `META-INF/container.xml` to the OPF path. */
export function parseContainerRootfile(xml: string): string | null {
  const m = /<rootfile[^>]*full-path="([^"]+)"/.exec(xml);
  return m?.[1] ?? null;
}

/**
 * Parse the OPF: manifest id→href plus spine idref order → spine doc hrefs,
 * resolved relative to the OPF's own directory (zip-internal, posix).
 */
export function parseOpfSpine(opfXml: string, opfPath: string): string[] {
  const hrefById = new Map<string, string>();
  for (const item of opfXml.matchAll(/<item\b[^>]*>/g)) {
    const tag = item[0];
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if (id && href) hrefById.set(id, decodeURIComponent(href));
  }
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const spine: string[] = [];
  for (const ref of opfXml.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"[^>]*>/g)) {
    const href = hrefById.get(ref[1] ?? "");
    if (href) spine.push(resolveHref(opfDir, href));
  }
  return spine;
}

/** Resolve a relative href against a zip-internal directory (posix, no fs). */
export function resolveHref(fromDir: string, href: string): string {
  const parts = (fromDir ? `${fromDir}/${href}` : href).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * Build the inventory from spine docs: images in document order, each paired with
 * the first caption-matching text block that follows it (position-accurate).
 * `page` = 1-based spine ordinal; EPUBs are never "scanned" (that's a PDF verdict).
 */
export function buildEpubInventory(docs: SpineDoc[]): FigureInventory {
  const entries: FigureEntry[] = [];
  for (let d = 0; d < docs.length; d++) {
    const doc = docs[d];
    if (doc) scanDoc(doc, d + 1, entries);
  }
  entries.forEach((e, i) => (e.index = i));
  const figures = entries.filter((e) => e.captioned);
  return {
    entries,
    pageCount: docs.length,
    scanned: false,
    counts: {
      figures: figures.length,
      uncaptioned: entries.length - figures.length,
      pageRender: figures.filter((e) => e.source !== "raster").length,
    },
  };
}

// Images in order: inline <svg> blocks first (they may wrap an <image> raster ref),
// then bare <img>. Case-insensitive; EPUB XHTML is lowercase in practice but cheap to allow.
const IMAGE_EVENT = /<svg\b[\s\S]*?<\/svg\s*>|<img\b[^>]*>/gi;

function scanDoc(doc: SpineDoc, page: number, entries: FigureEntry[]): void {
  const docDir = doc.href.includes("/") ? doc.href.slice(0, doc.href.lastIndexOf("/")) : "";
  IMAGE_EVENT.lastIndex = 0;
  for (const m of doc.html.matchAll(IMAGE_EVENT)) {
    const tag = m[0];
    const entry = entryFromImage(tag, docDir, doc.href, page);
    if (!entry) continue; // svg block with no drawable content
    const cap = adjacentCaption(doc.html, m.index + tag.length);
    if (cap) {
      entry.captioned = true;
      entry.label = cap.label;
      entry.caption = cap.text;
    }
    entries.push(entry);
  }
}

function entryFromImage(tag: string, docDir: string, spineHref: string, page: number): FigureEntry | null {
  const base: FigureEntry = { index: 0, page, captioned: false, source: "raster", spineHref };
  if (/^<img/i.test(tag)) {
    const src = attr(tag, "src");
    if (!src) return null;
    base.imageHref = resolveHref(docDir, src);
    // .svg served through <img> still needs rasterization at fetch time
    if (/\.svg$/i.test(base.imageHref)) base.source = "svg-render";
    setDims(base, tag);
    return base;
  }
  // inline <svg>: a wrapped <image> ref is a raster in disguise (the common cover trick);
  // real vector content gets rasterized from the doc at fetch time (no imageHref).
  const imageRef = /<image\b[^>]*>/i.exec(tag)?.[0];
  const href = imageRef ? (attr(imageRef, "href") ?? attr(imageRef, "xlink:href")) : null;
  if (href) {
    base.imageHref = resolveHref(docDir, href);
    base.source = /\.svg$/i.test(base.imageHref) ? "svg-render" : "raster";
    setDims(base, imageRef ?? tag);
    return base;
  }
  base.source = "svg-render";
  setDims(base, tag);
  return base;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name.replace(":", "\\:")}="([^"]+)"`, "i").exec(tag);
  return m?.[1] ?? null;
}

function setDims(entry: FigureEntry, tag: string): void {
  const w = attr(tag, "width");
  const h = attr(tag, "height");
  if (w && /^\d+$/.test(w)) entry.width = Number(w);
  if (h && /^\d+$/.test(h)) entry.height = Number(h);
}

// Caption-dedicated elements: headings and figcaption hold captions, never prose, so a
// numbered "Figure 4.1 Standard RL loop" WITHOUT a separator is trustworthy there
// (pandoc emits exactly that — RLHF Book probe). In <p>/<div> the separator stays
// required, or in-text references ("Figure 4.1 and how it compares…") would false-pair.
const CAPTION_ELEMENTS = new Set(["figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "caption"]);
// Greedy label first, so "Figure 4.1 Standard RL loop" keeps "4.1" whole (the strict
// pattern would misread the label's own dot as the separator); optional separator eaten.
const RELAXED_EN = /^(?:Figure|FIGURE|Fig\.)\s?(\d+(?:[-–.]\d+)?[a-z]?)(?:\s*[.:]|\s+[–—-])?(?:\s+|$)(.*)$/u;

/**
 * The caption is the first text-bearing block after the image: collect text runs
 * (across inline spans) until a block-level closing tag ends the block — or bail
 * when another image starts first. The collected text must match a caption pattern;
 * caption-dedicated elements additionally accept the separator-less form.
 */
export function adjacentCaption(html: string, from: number): { label: string; text: string } | null {
  const window = html.slice(from, from + CAPTION_WINDOW);
  let collected = "";
  let closerTag: string | null = null;
  const walker = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>|[^<]+/g;
  for (const m of window.matchAll(walker)) {
    const tagName = m[1]?.toLowerCase();
    if (!tagName) {
      collected += m[0];
      continue;
    }
    const closing = m[0].startsWith("</");
    if (!closing && (tagName === "img" || tagName === "svg")) break; // next image first
    if (closing && BLOCK_CLOSERS.has(tagName) && collected.trim()) {
      closerTag = tagName; // block ended — remember what kind of block held the text
      break;
    }
  }
  const text = decodeEntities(collected).replace(/\s+/g, " ").trim();
  if (!text) return null;
  // Caption-dedicated elements get the relaxed form FIRST — the strict pattern would
  // misparse a separator-less "Figure 4.1 Standard RL loop" (label dot read as separator).
  if (closerTag && CAPTION_ELEMENTS.has(closerTag) && text.length <= 300) {
    const relaxed = RELAXED_EN.exec(text);
    if (relaxed) return { label: relaxed[1] ?? "", text: (relaxed[2] ?? "").trim() };
  }
  return matchCaptionLine(text);
}

/** Minimal entity decode — captions only need the common named/numeric forms. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
