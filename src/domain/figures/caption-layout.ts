// Caption recovery from page layout (#107 follow-up): many PDFs set the caption text
// apart from its label, so the plain-text scan sees a bare "Figure 1.5" and a label-only
// Figure. `pdftotext -bbox-layout` geometry pairs them back: the text sits on the label's
// baseline to its right (Manning, Pearson) or fills the label's own block below it
// (narrow side-column captions). Pure logic — the poppler run lives in figure-inventory.ts.

import { decodeXml, type BboxWord } from "./band.js";
import {
  ADMONITION,
  type Caption,
  CAPTION_MAX,
  FIGURE_WORD,
  joinLine,
  markCut,
  PAGE_LIST_TAIL,
  PUA_LEAD,
} from "./captions.js";

/** One text line from `pdftotext -bbox-layout`, in PDF points, origin top-left. */
export interface LayoutLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Ordinal of the layout block the line belongs to — poppler's paragraph grouping. */
  block: number;
  words: BboxWord[];
  text: string;
}

export interface LayoutPage {
  lines: LayoutLine[];
}

const PAGE_RE = /<page\s[^>]*>([\s\S]*?)<\/page>/g;
const BLOCK_RE = /<block\s[^>]*>([\s\S]*?)<\/block>/g;
const LINE_RE = /<line\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)">([\s\S]*?)<\/line>/g;
const WORD_RE = /<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)">([^<]*)<\/word>/g;

/**
 * Parse `pdftotext -bbox-layout` output into lines, for the wanted 1-based pages only
 * (a whole book is ~20 MB of XML; most pages are never looked at). `firstPage` is the
 * `-f` the run started at, so page ordinals map back to book pages.
 */
export function parseBboxLayout(html: string, wanted: ReadonlySet<number>, firstPage = 1): Map<number, LayoutPage> {
  const pages = new Map<number, LayoutPage>();
  let page = firstPage - 1;
  for (const pm of html.matchAll(PAGE_RE)) {
    page++;
    if (!wanted.has(page)) continue;
    const lines: LayoutLine[] = [];
    let block = 0;
    for (const bm of (pm[1] ?? "").matchAll(BLOCK_RE)) {
      for (const lm of (bm[1] ?? "").matchAll(LINE_RE)) {
        const words: BboxWord[] = [];
        for (const wm of (lm[5] ?? "").matchAll(WORD_RE)) {
          words.push({
            x0: Number(wm[1]),
            y0: Number(wm[2]),
            x1: Number(wm[3]),
            y1: Number(wm[4]),
            text: decodeXml(wm[5] ?? ""),
          });
        }
        if (words.length === 0) continue;
        lines.push({
          x0: Number(lm[1]),
          y0: Number(lm[2]),
          x1: Number(lm[3]),
          y1: Number(lm[4]),
          block,
          words,
          text: words.map((w) => w.text).join(" "),
        });
      }
      block++;
    }
    pages.set(page, { lines });
  }
  return pages;
}

/** Pages carrying a label-only caption — the only ones worth a layout pass. */
export function labelOnlyPages(captions: readonly Caption[]): number[] {
  return [...new Set(captions.filter((c) => c.text === "").map((c) => c.page))].sort((a, b) => a - b);
}

/**
 * Fill label-only captions from page layout where it can be read safely; everything else
 * passes through unchanged (a page missing from `layout` stays label-only).
 */
export function recoverLabelOnlyCaptions(captions: Caption[], layout: ReadonlyMap<number, LayoutPage>): Caption[] {
  return captions.map((c) => {
    if (c.text !== "") return c;
    const page = layout.get(c.page);
    const text = page ? recoverCaptionText(page, c.label) : null;
    return text ? { ...c, text } : c;
  });
}

const KEYWORD = /^(?:Figure|FIGURE|Fig\.|Рис\.?|Рисунок|рис\.?|рисунок)$/u;
const FUSED_RU = /^[Рр]ис\.(\S+)$/u;
// Same-baseline gap, in label heights: Manning/Pearson set 8–10 pt between label and text
// (≈1.2–1.5 heights); a gutter to the next column is far wider.
const SAME_LINE_GAP_MAX = 3;
// Caption text shares the label's type size; diagram labels are often smaller, body text
// larger. Loose on purpose — Pearson sets the label bold, one point up (book 74).
const HEIGHT_RATIO_MIN = 0.75;
const HEIGHT_RATIO_MAX = 1.3;
/** A wrapped caption's next line starts within this much of its first line's left edge. */
const ALIGN_TOLERANCE = 3;
/** Most lines a recovered caption may span — narrow side columns wrap every 2–3 words. */
const MAX_LINES = 20;

/**
 * Caption text for `label` from one page's layout, or null when it can't be read safely.
 * The anchor is a line holding only the label. Two shapes count as its caption:
 * - same baseline: the nearest line to the anchor's right, within a short gap, plus the
 *   lines wrapped under it in its block ("Figure 1.2" ⟶ "Kafka's flow from producers…");
 * - column below: a narrow run of lines right under the label, flush with its left or right
 *   edge — a side-column caption ("Figure 3.6" / "Illustration" / "of gossip" / "communication";
 *   Wiley sets it flush right: "FIGURE 1-1:" / "A ChatGPT-" / "generated" / "HTML template.").
 * Diagram text near the label sits on other baselines or in other blocks, and the result
 * must still read as caption text (`besideShape` / `columnShape`), so stray labels stay null.
 * More than one anchor reading differently is ambiguous → null.
 */
export function recoverCaptionText(page: LayoutPage, label: string): string | null {
  const results = new Set<string>();
  for (const anchor of page.lines.filter((l) => isLabelLine(l, label))) {
    const beside = sameBaselineText(page, anchor);
    const below = blockBelowText(page, anchor);
    const text = (beside && finish(beside, besideShape)) ?? (below && finish(below, columnShape));
    if (text) results.add(text);
  }
  return results.size === 1 ? [...results][0]! : null;
}

/** True when the line is just `keyword label` (an optional trailing `.`/`:` allowed). */
function isLabelLine(line: LayoutLine, label: string): boolean {
  const words = line.words.map((w) => w.text).filter((t) => !/^[.:–—-]$/u.test(t));
  const want = normalizeLabel(label);
  if (words.length === 1) {
    const fused = FUSED_RU.exec(words[0] ?? "");
    return !!fused && normalizeLabel(fused[1] ?? "") === want;
  }
  return words.length === 2 && KEYWORD.test(words[0] ?? "") && normalizeLabel(words[1] ?? "") === want;
}

function sameBaselineText(page: LayoutPage, anchor: LayoutLine): LayoutLine[] | null {
  const h = height(anchor);
  let best: LayoutLine | null = null;
  for (const line of page.lines) {
    if (line === anchor || line.x0 < anchor.x1 - 1) continue;
    const overlap = Math.min(line.y1, anchor.y1) - Math.max(line.y0, anchor.y0);
    if (overlap < 0.5 * Math.min(h, height(line))) continue;
    if (line.x0 - anchor.x1 > SAME_LINE_GAP_MAX * h || !similarSize(line, anchor)) continue;
    if (!best || line.x0 < best.x0) best = line;
  }
  if (!best) return null;
  // the caption's own wrapped lines follow it in its block
  return [best, ...continuation(page, best, anchor.x0)];
}

// A side column is a few label-widths wide at most; a paragraph under the label is the
// full text width (book 947: "Figure 2-3" / "You can even think of the information…").
const COLUMN_WIDTH_MAX = 3.5;

function blockBelowText(page: LayoutPage, anchor: LayoutLine): LayoutLine[] | null {
  const h = height(anchor);
  const maxWidth = COLUMN_WIDTH_MAX * (anchor.x1 - anchor.x0);
  // which label edges the line is flush with: bit 1 = left, bit 2 = right, 0 = neither
  const flush = (line: LayoutLine): number => {
    if (line.x1 - line.x0 > maxWidth || !similarSize(line, anchor)) return 0;
    return (
      (Math.abs(line.x0 - anchor.x0) <= ALIGN_TOLERANCE ? 1 : 0) |
      (Math.abs(line.x1 - anchor.x1) <= ALIGN_TOLERANCE ? 2 : 0)
    );
  };
  // the nearest flush line starting right under the label, in its block or the next one
  let first: LayoutLine | null = null;
  for (const line of page.lines) {
    const gap = line.y0 - anchor.y1;
    if (line === anchor || gap < -1 || gap > h || !flush(line)) continue;
    if (!first || line.y0 < first.y0) first = line;
  }
  if (!first) return wideLineBelow(page, anchor);
  // a line as wide as the label is flush both ways; the column's edge is what the rest share
  let side = flush(first);
  const out = [first];
  for (let i = page.lines.indexOf(first) + 1; i < page.lines.length && out.length < MAX_LINES; i++) {
    const line = page.lines[i]!;
    const gap = line.y0 - out[out.length - 1]!.y1;
    if (line.block !== first.block || (flush(line) & side) === 0 || gap < -1 || gap > h) break;
    side &= flush(line);
    out.push(line);
  }
  return out;
}

// A full-width caption under its label (Wiley, book 1231: "FIGURE 1.3" / "The software
// design process and design activities…") passes only as a whole block of its own that
// ends a sentence — a paragraph opening under a label runs longer and on (book 947).
const WIDE_BLOCK_LINES_MAX = 2;
const SENTENCE_END = /[.!?]["'”»)]?$/u;

function wideLineBelow(page: LayoutPage, anchor: LayoutLine): LayoutLine[] | null {
  const h = height(anchor);
  const first = page.lines.find((line) => {
    const gap = line.y0 - anchor.y1;
    return (
      line !== anchor &&
      gap >= -1 &&
      gap <= h &&
      Math.abs(line.x0 - anchor.x0) <= ALIGN_TOLERANCE &&
      similarSize(line, anchor)
    );
  });
  if (!first) return null;
  const block = page.lines.filter((l) => l.block === first.block);
  if (block[0] !== first || block.length > WIDE_BLOCK_LINES_MAX) return null;
  if (block.some((l) => Math.abs(l.x0 - first.x0) > ALIGN_TOLERANCE || !similarSize(l, first))) return null;
  return SENTENCE_END.test(block[block.length - 1]!.text.trim()) ? block : null;
}

/**
 * The lines after `first` in its block that read as its wrap: same block, same type size,
 * tightly spaced, in order, and either left-aligned with `first`, set inside its width
 * (centered captions, book 1234: "…diagram drawn on the" / "wall of a team's work area"),
 * or flush with `hangLeft` — the label's edge, under which a hanging caption wraps (938).
 */
function continuation(page: LayoutPage, first: LayoutLine, hangLeft?: number): LayoutLine[] {
  const out: LayoutLine[] = [];
  let prev = first;
  const start = page.lines.indexOf(first);
  for (let i = start + 1; i < page.lines.length && out.length < MAX_LINES - 1; i++) {
    const line = page.lines[i]!;
    if (line.block !== first.block) break;
    const gap = line.y0 - prev.y1;
    const aligned =
      Math.abs(line.x0 - first.x0) <= ALIGN_TOLERANCE ||
      (hangLeft !== undefined && Math.abs(line.x0 - hangLeft) <= ALIGN_TOLERANCE);
    const inside = line.x0 >= first.x0 - ALIGN_TOLERANCE && line.x1 <= first.x1 + ALIGN_TOLERANCE;
    if (!(aligned || inside) || !similarSize(line, first) || gap < -1 || gap > height(prev)) break;
    out.push(line);
    prev = line;
  }
  return out;
}

// Text on the label's own baseline is placed as its caption, so the shape gate is looser
// than for a block under the label: one word ("Brokers", book 182), identifier and
// mixed-case starts ("jMock Expectations…", "RESTful web services.", "Q&A…") all count.
// Still out: a bare number (index rows), admonitions, a second label.
const BESIDE_START = /^[\p{L}\d(]/u;
const BARE_NUMBER = /^[\d\s.,–-]+$/u;

function besideShape(text: string): boolean {
  return BESIDE_START.test(text) && !BARE_NUMBER.test(text) && !ADMONITION.test(text) && /\p{L}{2}/u.test(text);
}

// A column under the label is placed too, but diagram labels also stack under things:
// it must open capitalized (any case after: "ESLint reports on…") and run 2+ words.
const COLUMN_START = /^[\p{Lu}\d(]/u;

function columnShape(text: string): boolean {
  const words = text.split(/[\s-]+/u).filter((w) => /\p{L}/u.test(w)).length;
  return besideShape(text) && COLUMN_START.test(text) && words >= 2 && !PAGE_LIST_TAIL.test(text);
}

/** Join the lines into caption text and apply the text-shape gate; null when it fails. */
function finish(lines: LayoutLine[], shape: (text: string) => boolean): string | null {
  let text = (lines[0]?.text ?? "").replace(PUA_LEAD, "").trim();
  for (const line of lines.slice(1)) {
    if (text.length >= CAPTION_MAX) break;
    text = joinLine(text, line.text.trim());
  }
  // gate the joined text: a side-column caption's first line can be one word ("Illustration")
  if (!shape(text) || FIGURE_WORD.test(text)) return null;
  return markCut(text);
}

function height(line: LayoutLine): number {
  return line.y1 - line.y0;
}

function similarSize(a: LayoutLine, b: LayoutLine): boolean {
  const ratio = height(a) / height(b);
  return ratio >= HEIGHT_RATIO_MIN && ratio <= HEIGHT_RATIO_MAX;
}

/** Label as printed → comparable form (`1.5.` ≙ `1.5`, `2-1` ≙ `2.1`). */
function normalizeLabel(s: string): string {
  return s.replace(/[.:,]+$/u, "").replace(/[-–.,]/gu, ".");
}
