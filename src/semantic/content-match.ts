// Content freshness without a stored fingerprint (#244): Calibre bumps last_modified on ANY
// metadata edit, so the stored chunks themselves are the fingerprint — if a fresh extraction
// still reproduces every chunk at its offsets with nothing new around them, the text did not
// change and the book's vectors are still valid.

/** One stored chunk: its raw body and its exact offsets in the text it was cut from. */
export interface ChunkSpan {
  charStart: number;
  charEnd: number;
  body: string;
}

/**
 * True when `text` is the text `spans` were chunked from: every span re-slices to its body,
 * and anything outside the spans (gaps, head, tail) is whitespace only — the chunker drops
 * whitespace-only windows. `spans` must be sorted by charStart; no spans never match.
 */
export function textMatchesChunks(text: string, spans: readonly ChunkSpan[]): boolean {
  if (spans.length === 0) return false;
  let covered = 0;
  for (const s of spans) {
    if (s.charEnd > text.length || text.slice(s.charStart, s.charEnd) !== s.body) return false;
    if (s.charStart > covered && text.slice(covered, s.charStart).trim() !== "") return false;
    covered = Math.max(covered, s.charEnd);
  }
  return text.slice(covered).trim() === "";
}
