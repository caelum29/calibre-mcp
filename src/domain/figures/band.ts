// Vector-figure band crop (D-018 / probe #77): a figure pdfimages cannot see is
// rendered as the vertical band ABOVE its caption line — captions sit under their
// figures, so the band top is the previous caption's bottom (or page top) and the
// band bottom is the caption's own bottom edge. Coordinates come from
// `pdftotext -bbox` words; matching is word-sequence based, never reconstructed
// lines (probe: line grouping merges diagram text into the caption line).

/** One word from `pdftotext -bbox`, in PDF points, origin top-left. */
export interface BboxWord {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
}

export interface BboxPage {
  width: number;
  height: number;
  words: BboxWord[];
}

/** Vertical band to render, in PDF points (full page width). */
export interface Band {
  top: number;
  bottom: number;
}

/** Parse the first `<page>` of `pdftotext -bbox` output (we run it single-page). */
export function parseBboxPage(html: string): BboxPage | null {
  const pageTag = /<page\s+width="([\d.]+)"\s+height="([\d.]+)"/.exec(html);
  if (!pageTag) return null;
  const words: BboxWord[] = [];
  const wordRe =
    /<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)">([^<]*)<\/word>/g;
  for (const m of html.matchAll(wordRe)) {
    words.push({
      x0: Number(m[1]),
      y0: Number(m[2]),
      x1: Number(m[3]),
      y1: Number(m[4]),
      text: decodeXml(m[5] ?? ""),
    });
  }
  return { width: Number(pageTag[1]), height: Number(pageTag[2]), words };
}

// Caption keywords as standalone words; RU allows the fused no-space form (рис.15.7).
const KEYWORD = /^(?:Figure|FIGURE|Fig\.?|Рис(?:унок)?\.?|рис(?:унок)?\.?)$/u;
const FUSED_RU = /^рис\.?\s*(\S+)$/iu;

interface AnchorMatch {
  y0: number;
  y1: number;
  /** A word with letters follows the label on roughly the same line — bare
   * "Figure 3-8." refs wrapped to line start have none (probe failure 1). */
  hasTextAfter: boolean;
}

/**
 * Find all occurrences of `keyword + label` as adjacent words on the page.
 * Label comparison strips trailing punctuation ("3-8." ≙ "3-8").
 */
export function findAnchors(page: BboxPage, label: string): AnchorMatch[] {
  const want = normalizeLabel(label);
  const out: AnchorMatch[] = [];
  const words = page.words;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w) continue;
    let labelWord: BboxWord | undefined;
    let after: BboxWord | undefined;
    const fused = FUSED_RU.exec(w.text);
    if (fused && normalizeLabel(fused[1] ?? "") === want) {
      labelWord = w;
      after = words[i + 1];
    } else if (KEYWORD.test(w.text)) {
      const next = words[i + 1];
      if (!next || normalizeLabel(next.text) !== want) continue;
      labelWord = next;
      after = words[i + 2];
    } else {
      continue;
    }
    // "same line" = vertical overlap with the label word; \p{L} = real caption text
    const hasTextAfter =
      !!after && after.y0 < labelWord.y1 && after.y1 > labelWord.y0 && /\p{L}/u.test(after.text);
    out.push({ y0: labelWord.y0, y1: labelWord.y1, hasTextAfter });
  }
  return out;
}

/**
 * Pick the caption anchor among matches (probe #77 fixes): prefer matches with
 * caption text after the label, and among those take the LOWEST on the page —
 * real captions sit under their figure, in-text references sit in prose above.
 */
export function selectAnchor(matches: AnchorMatch[]): AnchorMatch | null {
  if (matches.length === 0) return null;
  const preferred = matches.filter((m) => m.hasTextAfter);
  const pool = preferred.length > 0 ? preferred : matches;
  return pool.reduce((best, m) => (m.y0 > best.y0 ? m : best));
}

const BAND_PAD_PT = 3;

/**
 * Compute the band for a caption anchor: top = the bottom of the lowest OTHER
 * caption anchor fully above ours (their figure ends where their caption does),
 * else page top; bottom = our caption's bottom edge (caption included — the crop
 * stays self-describing).
 */
export function computeBand(page: BboxPage, anchor: AnchorMatch, othersAbove: AnchorMatch[]): Band {
  let top = 0;
  for (const other of othersAbove) {
    if (other.y1 <= anchor.y0 && other.y1 > top) top = other.y1;
  }
  return { top, bottom: Math.min(page.height, anchor.y1 + BAND_PAD_PT) };
}

/** Label as printed → comparable form: trim trailing `.`/`:`/`,` (word tokens carry them). */
function normalizeLabel(s: string): string {
  return s.replace(/[.:,]+$/, "");
}

function decodeXml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
