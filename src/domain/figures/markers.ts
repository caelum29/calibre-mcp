// Inline image markers (D-018 Phase B / #75): inject `[image #N: page P, "caption"]`
// lines into extracted book text so an agent reading a chapter can fetch exactly the
// figure it just walked past via calibre_get_figures indexes=[N]. Pure logic — the
// extraction/caching seam lives in src/calibre/extract.ts.

import { matchCaptionLine } from "./captions.js";
import type { FigureEntry, FigureInventory } from "./inventory.js";

/** One placed marker; offsets index into the RETURNED (marker-injected) text. */
export interface FigureMarker {
  /** FigureEntry.index — the handle calibre_get_figures fetches by. */
  index: number;
  /** Marker start offset in the returned text (the `[` of `[image`). */
  charOffset: number;
  /** PDF: 1-based page. EPUB: spine-document ordinal (not shown in the marker). */
  page: number;
  caption: string;
}

export interface MarkedText {
  text: string;
  markers: FigureMarker[];
  /** Captioned figures no marker could be placed for (caption absent from this text). */
  unplaced: number;
}

/** Keeps the marker line short — the caption is a pointer, not the payload. */
const MARKER_CAPTION_MAX = 120;

/** Render one marker line. EPUB "pages" are spine ordinals — meaningless to a reader, omitted. */
export function formatMarker(index: number, page: number, caption: string, format: string): string {
  const cap = truncate(collapseWs(caption), MARKER_CAPTION_MAX);
  const pagePart = format === "pdf" ? ` page ${page},` : "";
  return `[image #${index}:${pagePart} "${cap}"]`;
}

/**
 * Inject a marker line above each captioned figure's caption line. Placement:
 * caption-line match first (position-accurate; EPUB's only option), then the PDF
 * page boundary (`\f` from pdftotext), else honestly unplaced — never a guess.
 * Uncaptioned entries get no marker (hidden by default per D-018).
 */
export function injectFigureMarkers(text: string, inventory: FigureInventory, format: string): MarkedText {
  const captioned = inventory.entries.filter((e) => e.captioned);
  if (captioned.length === 0) return { text, markers: [], unplaced: 0 };

  const lines = scanCaptionLines(text);
  const pageStarts = format === "pdf" ? scanPageStarts(text) : [];

  // Order-preserving greedy match: each caption line anchors at most one figure, so a
  // book with two "Figure 2.1" captions (bad numbering exists) keeps document order.
  interface Placement {
    entry: FigureEntry;
    at: number;
    caption: string;
  }
  const placements: Placement[] = [];
  let unplaced = 0;
  let cursor = 0; // next candidate line — matches never go backwards in document order
  for (const entry of captioned) {
    const hit = findCaptionLine(lines, cursor, entry);
    if (hit >= 0) {
      const line = lines[hit]!;
      cursor = hit + 1;
      placements.push({ entry, at: line.start, caption: line.text });
      continue;
    }
    const pageStart = pageStarts[entry.page - 1];
    if (pageStart !== undefined) {
      // page-boundary fallback: right after the page's form feed
      placements.push({ entry, at: pageStart, caption: composeCaption(entry) });
      continue;
    }
    unplaced += 1;
  }

  // Insert back-to-front so earlier offsets stay valid, then report marker offsets
  // in the final text coordinates (front-to-back cumulative shift).
  placements.sort((a, b) => a.at - b.at || a.entry.index - b.entry.index);
  let out = text;
  for (let i = placements.length - 1; i >= 0; i--) {
    const p = placements[i]!;
    const marker = formatMarker(p.entry.index, p.entry.page, p.caption, format);
    out = `${out.slice(0, p.at)}${marker}\n${out.slice(p.at)}`;
  }
  let shift = 0;
  const markers: FigureMarker[] = placements.map((p) => {
    const marker = formatMarker(p.entry.index, p.entry.page, p.caption, format);
    const m: FigureMarker = {
      index: p.entry.index,
      charOffset: p.at + shift,
      page: p.entry.page,
      caption: truncate(collapseWs(p.caption), MARKER_CAPTION_MAX),
    };
    shift += marker.length + 1; // +1 for the marker's own newline
    return m;
  });
  return { text: out, markers, unplaced };
}

interface CaptionLine {
  start: number;
  label: string;
  text: string;
}

/** Scan all lines that look like captions, with their start offsets in `text`. */
function scanCaptionLines(text: string): CaptionLine[] {
  const found: CaptionLine[] = [];
  let start = 0;
  for (const raw of text.split("\n")) {
    // ebook-convert markdown dresses captions up (`##### **Figure 1.1** A rendition…`,
    // `*Figure 12.1 – Logical…*`): strip heading/quote prefixes, then turn emphasis
    // spans into a wide gap — `**Figure 1.1** Text` ends the bold right where a real
    // separator would sit, so the gap makes the Manning caption pattern match it.
    const stripped = raw
      .replace(/^[\s>#]+/, "")
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1  ")
      .replace(/\s+$/, "");
    const hit = matchCaptionLine(stripped);
    if (hit) found.push({ start, label: hit.label, text: stripped });
    start += raw.length + 1;
  }
  return found;
}

/** Start offset of each 1-based page (index p-1), from pdftotext's `\f` breaks. */
function scanPageStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\f") starts.push(i + 1);
  }
  return starts;
}

/**
 * Find the caption line for one figure at or after `from`. Label must match; when the
 * inventory carries caption text (it usually does), the line must contain its head too —
 * a bare in-text reference ("see Figure 2.1") never carries the caption words.
 */
function findCaptionLine(lines: CaptionLine[], from: number, entry: FigureEntry): number {
  const label = entry.label ?? "";
  const head = collapseWs(entry.caption ?? "").slice(0, 30).toLowerCase();
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    if (normalizeLabel(line.label) !== normalizeLabel(label)) continue;
    if (head.length > 0 && !collapseWs(line.text).toLowerCase().includes(head)) continue;
    return i;
  }
  return -1;
}

/** Fallback caption when the line itself wasn't found (page-boundary placement). */
function composeCaption(entry: FigureEntry): string {
  const label = entry.label ?? "";
  const text = entry.caption ?? "";
  return [label, text].filter((s) => s.length > 0).join(". ");
}

/** Label separators vary between scans (`2-1` vs `2.1` vs `2–1`) — compare canonically. */
function normalizeLabel(label: string): string {
  return label.replace(/[-–.,]/g, ".");
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}