// Pure text chunker for calibre_get_content. Slices a book's extracted text into capped
// windows the model can walk via a cursor. sentenceAware trims a window back to the last
// sentence/paragraph boundary so chunks don't end mid-sentence — but never below half of
// maxChars, to avoid pathologically tiny pages.

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

/** Trim a window back to the last sentence/paragraph boundary at or above `floor`. */
function trimToBoundary(window: string, floor: number): string {
  for (let i = window.length - 1; i >= floor; i--) {
    const ch = window.charAt(i);
    if (ch === "\n") return window.slice(0, i + 1);
    if (ch === "." || ch === "!" || ch === "?") {
      const next = window.charAt(i + 1); // "" when at the window end
      if (next === "" || /\s/.test(next)) return window.slice(0, i + 1);
    }
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
    window = trimToBoundary(window, Math.floor(maxChars * 0.5));
  }

  // Never cut between surrogate halves (only possible when we kept the full window).
  if (!reachesEnd && window.length > 0 && isHighSurrogate(window.charCodeAt(window.length - 1))) {
    window = window.slice(0, -1);
  }

  const end = start + window.length;
  return { slice: window, start, end, totalChars, hasMore: end < totalChars };
}
