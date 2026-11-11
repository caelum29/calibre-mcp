// Pure text chunker for calibre_get_content. Slices a book's extracted text into capped
// windows the model can walk via a cursor. sentenceAware trims a window back to the last
// sentence end (else a paragraph break) so chunks don't end mid-sentence — but never below
// half of maxChars, to avoid pathologically tiny pages.

export interface ChunkResult {
  /** The excerpt for this page. */
  slice: string;
  /** Offset this slice started at (clamped into range). */
  start: number;
  /** Next offset to request (== start + slice.length). */
  end: number;
  /** Total characters in the whole book text. */
  totalChars: number;
  /** Whether more text remains after `end`. */
  hasMore: boolean;
}

export interface ChunkOptions {
  offset: number;
  maxChars: number;
  sentenceAware: boolean;
}

/** True for a UTF-16 high surrogate (first half of an astral-plane code point). */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** True for `.`, `!` or `?` — the sentence ends sentenceAware prefers. */
function isSentenceEnd(ch: string): boolean {
  return ch === "." || ch === "!" || ch === "?";
}

/**
 * Trim a window back to the last boundary at or above `floor`. `after` is the text char right
 * past the window ("" at the book end), so a cut at the window edge can be checked too.
 * A plain "\n" is never a boundary: pdftotext hard-wraps every line (#551).
 */
function trimToBoundary(window: string, floor: number, after: string): string {
  const charAt = (i: number) => (i < window.length ? window.charAt(i) : after);
  // 1) the last sentence end: `.!?` followed by whitespace ("3.14" is not one)
  for (let i = window.length - 1; i >= floor; i--) {
    const next = charAt(i + 1);
    if (isSentenceEnd(window.charAt(i)) && (next === "" || /\s/.test(next))) {
      return window.slice(0, i + 1);
    }
  }
  // 2) else the last paragraph break ("\n\n"); one next to a form feed is a page end, which
  // pdftotext emits mid-sentence, so it doesn't count
  for (let i = window.length - 1; i >= floor; i--) {
    if (window.charAt(i) !== "\n" || window.charAt(i - 1) !== "\n") continue;
    if (charAt(i + 1) === "\f" || window.charAt(i - 2) === "\f") continue;
    return window.slice(0, i + 1);
  }
  return window; // no boundary above the floor → keep the full window
}

/** Slice `text` into one capped, optionally sentence-aware window starting at `offset`. */
export function chunkText(text: string, opts: ChunkOptions): ChunkResult {
  const totalChars = text.length;
  const maxChars = Math.max(1, Math.trunc(opts.maxChars));
  const start = Math.min(Math.max(0, Math.trunc(opts.offset)), totalChars);

  if (start >= totalChars) {
    return { slice: "", start, end: totalChars, totalChars, hasMore: false };
  }

  let window = text.slice(start, start + maxChars);
  const reachesEnd = start + window.length >= totalChars;

  if (opts.sentenceAware && !reachesEnd) {
    window = trimToBoundary(window, Math.floor(maxChars * 0.5), text.charAt(start + window.length));
  }

  // Never cut between surrogate halves (only possible when we kept the full window).
  if (!reachesEnd && window.length > 0 && isHighSurrogate(window.charCodeAt(window.length - 1))) {
    window = window.slice(0, -1);
  }

  const end = start + window.length;
  return { slice: window, start, end, totalChars, hasMore: end < totalChars };
}
