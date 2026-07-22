// Caption-line detection for the Figure inventory (D-018, CONTEXT.md § Book images).
// A Figure is an image the text refers to; the caption line is its anchor. Patterns are
// a code constant on purpose — extending them is a PR, never config or user regex (#30).

/** A caption line found in extracted page text. */
export interface Caption {
  /** 1-based PDF page the caption line sits on. */
  page: number;
  /** Figure number as printed (`1-1`, `15.7`) — kept as a string, separators vary. */
  label: string;
  /** Caption text after the label, trimmed; may be empty when the line is bare. */
  text: string;
}

// Line-start caption patterns. The separator after the number is what distinguishes a
// caption ("Figure 1-1. The mental model…") from an in-text reference ("Figure 1-1
// illustrates…") — probe 2026-07-22: O'Reilly uses `.`, No Starch `:`, Packt a spaced
// dash ("Figure 12.1 – Logical architecture…", EPUB probe #78; space required so the
// label's own hyphen never reads as a separator). Leading \f is real: pdftotext starts
// each page with a form feed, and a caption can be the first line of a page.
// RU: `Рис. 15.7.` (Lesovsky) and no-space `рис.15.7` (Nikolskiy).
const CAPTION_PATTERNS: readonly RegExp[] = [
  // EN: Figure 1-1. … | Figure 1.1: … | Fig. 3. … | Figure 12.1 – …
  // (?!\d) keeps a dotted label whole: "Figure 4.1 and…" must not backtrack into
  // label "4" + separator "." + text "1 and…" — an in-text reference, not a caption.
  /^[\f\s]*(?:Figure|FIGURE|Fig\.)\s?(\d+(?:[-–.]\d+)?[a-z]?)\s*(?:[.:](?!\d)|\s[–—-])\s*(.*)$/u,
  // RU: Рис. 15.7. … | рис.15.7 … | Рисунок 3. …
  /^[\f\s]*(?:Рис(?:унок)?|рис(?:унок)?)\.?\s?(\d+(?:[.,–-]\d+)?)\.?\s*[–—-]?\s*(.*)$/u,
];

/** Split extracted PDF text into pages on the form feeds pdftotext emits. */
export function splitPages(text: string): string[] {
  return text.split("\f");
}

/** Scan extracted text (with `\f` page breaks) for caption lines, in document order. */
export function scanCaptions(text: string): Caption[] {
  const captions: Caption[] = [];
  const pages = splitPages(text);
  for (let p = 0; p < pages.length; p++) {
    for (const line of (pages[p] ?? "").split("\n")) {
      const hit = matchCaptionLine(line);
      if (hit) captions.push({ page: p + 1, ...hit });
    }
  }
  return captions;
}

/** Match one line against the caption patterns; null when it isn't a caption. */
export function matchCaptionLine(line: string): { label: string; text: string } | null {
  // Guard: long lines are prose that happens to start with "Figure …" mid-sentence
  // wrapped to line start; real captions are short. 300 chars is generous.
  if (line.length > 300) return null;
  for (const re of CAPTION_PATTERNS) {
    const m = re.exec(line);
    if (m) return { label: m[1] ?? "", text: (m[2] ?? "").trim() };
  }
  return null;
}
