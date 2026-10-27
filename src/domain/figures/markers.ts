// Inline image markers (D-018 Phase B / #75): inject `[image #N: page P, "caption"]`
// lines into extracted book text so an agent reading a chapter can fetch exactly the
// figure it just walked past via calibre_get_figures indexes=[N]. Pure logic — the
// extraction/caching seam lives in src/calibre/extract.ts.

import { scanPageStarts } from "../page-offsets.js";
import { matchBareLabel, matchCaptionElement, matchCaptionLine } from "./captions.js";
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

  // pdftotext output is plain text (a `*`/`_` there is literal); everything else came
  // through ebook-convert's markdown writer
  const lines = scanCaptionLines(text, format !== "pdf");
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
    const hit = findCaptionLine(lines, cursor, entry, pageStarts);
    if (hit) {
      const line = lines[hit.index]!;
      cursor = hit.index + 1;
      // a layout-read caption isn't on the line's neighbour: show the label + inventory text
      const caption = hit.byPage ? `${line.own} ${entry.caption ?? ""}` : line.text;
      placements.push({ entry, at: line.start, caption });
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
  /** Caption text after the label (the pattern's text group). */
  captionText: string;
  /** The physically next line — a wrapped caption's continuation (#107). */
  nextLine: string;
  /** A label-only head ("Figure 1.5" alone): its caption text may sit elsewhere on the page. */
  bare: boolean;
  /** The line itself, without the next line a label-only head borrows. */
  own: string;
}

/** Scan all lines that look like captions, with their start offsets in `text`. */
function scanCaptionLines(text: string, markdown: boolean): CaptionLine[] {
  const found: CaptionLine[] = [];
  let start = 0;
  const rawLines = text.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    // ebook-convert markdown dresses captions up (`##### **Figure 1.1** A rendition…`,
    // `*Figure 12.1 – Logical…*`): strip heading/quote prefixes, then turn emphasis
    // spans into a wide gap — `**Figure 1.1** Text` ends the bold right where a real
    // separator would sit, so the gap makes the Manning caption pattern match it.
    // Escaped `\_`/`\*` are literal text (`add\_one`), never an emphasis edge.
    let stripped = raw.replace(/^[\s>#]+/, "");
    // Inline code is literal: `managed_new_default` must not pair `_new_` as emphasis.
    // Escape its markers and drop the backticks (#101).
    if (markdown) stripped = stripped.replace(/`([^`]*)`/g, (_, code: string) => code.replace(/[*_]/g, "\\$&"));
    // Markdown only: in pdftotext output `_` is literal, and pairing it mangled identifier
    // captions ("task_struct, thread_info" → "taskstruct, thread  info"), leaving 57 of
    // book 175's figures on the page-boundary fallback (#107).
    if (markdown) stripped = stripped.replace(/(?<!\\)[*_]{1,2}((?:\\[*_]|[^*_])+?)(?<!\\)[*_]{1,2}/g, "$1  ");
    // Then drop the unpaired leftovers: BPB's italic-wrapped bold label `***Figure 1.1:**
    // Text*` keeps its outer `*` after the pairing pass, and inline code inside a bold
    // caption leaves `****\`Book\`****` debris that pushed long Manning captions past the
    // 300-char guard (#101). Unescaped `*`/backticks are always markup in ebook-convert
    // markdown (it escapes literal ones) — but literal text in pdftotext output.
    if (markdown) stripped = stripped.replace(/(?<!\\)[*`]+/g, "");
    stripped = stripped.trim();
    // A markdown heading is ebook-convert's rendering of a caption-dedicated element
    // (`<h5>Figure 1.1 Text</h5>` → `##### Figure 1.1 Text`, newer Manning EPUBs): give it
    // the same separator-less trust the EPUB inventory gave the element (#101).
    // Collapsed first: the relaxed form needs no emphasis gap, and the gaps would count
    // against the 300-char guard.
    // A line wholly wrapped in emphasis (`**Figure 2.1 Docker client and engine.**`) is a
    // caption-styled paragraph, not prose — same trust.
    const heading = markdown && (/^\s*#/.test(raw) || /^\s*[*_].*[*_]\s*$/.test(raw));
    const hit = heading ? matchCaptionElement(collapseWs(stripped)) : matchCaptionLine(stripped);
    const nextLine = (rawLines[i + 1] ?? "").trim();
    // label-only head (#107: "Figure 12-2:" or a bare "Figure 2.10"): the caption text is
    // the next line, so compare that
    const head = hit ?? matchBareLabel(stripped);
    if (head && head.text === "") {
      found.push({
        start,
        label: head.label,
        text: `${stripped} ${nextLine}`,
        captionText: nextLine,
        nextLine: "",
        bare: true,
        own: stripped,
      });
    } else if (head) {
      found.push({
        start,
        label: head.label,
        text: stripped,
        captionText: head.text,
        nextLine,
        bare: false,
        own: stripped,
      });
    }
    start += raw.length + 1;
  }
  return found;
}

/**
 * Find the caption line for one figure at or after `from`. Label must match; when the
 * inventory carries caption text (it usually does), the line must contain its head too —
 * a bare in-text reference ("see Figure 2.1") never carries the caption words. A line
 * whose caption text is a solid prefix of the inventory caption also counts: the spine
 * walk joins a `<br/>`-separated credit ("Postman screenshotSource: …") that the txt puts
 * on its own line (#101). On a PDF, a label-only head on the figure's own page anchors it
 * too: the inventory read that caption's text from page layout, beside or below the
 * label, where the text stream puts it lines away (#107 follow-up).
 */
function findCaptionLine(
  lines: CaptionLine[],
  from: number,
  entry: FigureEntry,
  pageStarts: number[],
): { index: number; byPage: boolean } | null {
  const label = entry.label ?? "";
  const full = comparable(entry.caption ?? "");
  // head = the first 30 chars of the ws-collapsed caption, compared ws-free
  const head = comparable(collapseWs(entry.caption ?? "").slice(0, 30));
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    if (normalizeLabel(line.label) !== normalizeLabel(label)) continue;
    if (head.length > 0 && !comparable(line.text).includes(head) && !isCaptionPrefix(line, full)) continue;
    return { index: i, byPage: false };
  }
  if (pageStarts.length === 0) return null;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    // +1: a page-first line starts on the form feed that opens its page (book 836)
    const page = pageOf(line.start + 1, pageStarts);
    if (page > entry.page) break;
    if (line.bare && page === entry.page && normalizeLabel(line.label) === normalizeLabel(label))
      return { index: i, byPage: true };
  }
  return null;
}

/** 1-based page holding text offset `at` (`pageStarts[k]` = offset where page k+1 begins). */
function pageOf(at: number, pageStarts: number[]): number {
  let lo = 0;
  let hi = pageStarts.length; // count of starts <= at, by binary search
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((pageStarts[mid] as number) <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Shortest line caption trusted as a prefix match — shorter is too generic to anchor on. */
const PREFIX_MIN = 12;

function isCaptionPrefix(line: CaptionLine, fullComparable: string): boolean {
  const own = comparable(line.captionText);
  if (own.length >= PREFIX_MIN && fullComparable.startsWith(own)) return true;
  // The inventory joins wrapped captions (#107), so a first line shorter than the minimum
  // ("Рис. 3.1  Отношение,") still anchors once its continuation line is counted.
  // Either side may run longer: the two extractors break lines in different places.
  const joined = comparable(`${line.captionText} ${line.nextLine}`);
  if (own.length === 0 || joined.length < PREFIX_MIN || fullComparable.length < PREFIX_MIN) return false;
  return fullComparable.startsWith(joined) || joined.startsWith(fullComparable);
}

/**
 * Comparison form for caption-head containment: whitespace-free, lowercased, backslashes
 * stripped. ebook-convert's txt escapes markdown specials (`\(A\)`, `\+`) while the
 * inventory caption is clean HTML text — an escapable char inside the 30-char head made
 * the figure silently unplaceable (book 929: Figs 2-2, 7-6). Whitespace goes entirely, not
 * just collapsed: emphasis gaps land mid-caption (`class \`Book\`, a` → `class Book  , a`).
 */
function comparable(s: string): string {
  return s.replace(/\s+/g, "").replace(/\\/g, "").toLowerCase();
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
