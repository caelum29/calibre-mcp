// Splits a book's extracted text into overlapping windows for embedding. Distinct from
// content-chunk.ts (single cursor-walked page) — this yields the FULL array of chunks with
// recovered char offsets and overlap, which become each vector's {char_start, char_end}
// location (pairs with calibre_get_content offsets).
//
// v1 is CHAR-based. e5's tokenizer truncates silently at 512 tokens, so the only cost is
// tail loss on the densest Cyrillic chunks (RU tokenizes ~2× denser than Latin) — a bounded
// recall dent, acceptable for a first slice. The conservative ~900-char budget leaves headroom
// under the ~1024-char/512-tok RU worst case plus the "[title › authors]" context prefix.
// The `lengthFn` seam lets the next increment swap in the model tokenizer for token budgeting.

/** One chunk with its character span in the original text. */
export interface EmbedChunk {
  body: string;
  charStart: number;
  charEnd: number;
}

export interface ChunkForEmbeddingOptions {
  /** Target chunk size (in `lengthFn` units, default characters). */
  budget?: number;
  /** Overlap carried between consecutive chunks (same units). */
  overlap?: number;
  /** Length function — defaults to character count; the token-based seam. */
  lengthFn?: (s: string) => number;
}

const DEFAULT_BUDGET = 900;
const DEFAULT_OVERLAP = 120;

// Preferred break points, strongest first: markdown headings, blank lines, newlines,
// sentence ends, then whitespace. Splitting on these keeps chunks semantically coherent.
const SEPARATORS = ["\n## ", "\n### ", "\n\n", "\n", ". ", " "];

/** True for a UTF-16 high surrogate (first half of an astral code point). */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Find a break offset within `[floor, hardEnd)` of `text`, preferring the latest strong
 * separator. Returns `hardEnd` when none is found (hard split). Never splits a surrogate pair.
 */
function findBreak(text: string, floor: number, hardEnd: number): number {
  for (const sep of SEPARATORS) {
    // Last occurrence of this separator that still leaves a reasonably full chunk.
    const at = text.lastIndexOf(sep, hardEnd - 1);
    if (at >= floor) {
      const end = at + sep.length; // break AFTER the separator so it stays with this chunk
      if (end <= hardEnd) return end;
    }
  }
  // No separator → hard split, but back off one char rather than bisect a surrogate pair.
  if (isHighSurrogate(text.charCodeAt(hardEnd - 1))) return hardEnd - 1;
  return hardEnd;
}

/**
 * Chunk `text` into overlapping windows. Offsets are exact positions in the ORIGINAL text
 * (so callers can re-slice via calibre_get_content). Whitespace-only tail chunks are dropped.
 */
export function chunkForEmbedding(text: string, opts: ChunkForEmbeddingOptions = {}): EmbedChunk[] {
  const budget = Math.max(1, Math.trunc(opts.budget ?? DEFAULT_BUDGET));
  const overlap = Math.max(0, Math.min(Math.trunc(opts.overlap ?? DEFAULT_OVERLAP), budget - 1));
  const len = opts.lengthFn ?? ((s: string) => s.length);
  const total = text.length;
  if (total === 0) return [];

  const chunks: EmbedChunk[] = [];
  let start = 0;

  while (start < total) {
    // Grow the window char-by-char until it hits the length budget (lengthFn may be non-linear
    // for token counting), capping the scan at a generous char ceiling for that budget.
    let hardEnd = Math.min(total, start + budget * 4);
    // Binary-free linear probe: shrink hardEnd down to the largest slice within budget.
    while (hardEnd > start + 1 && len(text.slice(start, hardEnd)) > budget) {
      hardEnd -= Math.max(1, Math.ceil((hardEnd - start) / 8));
    }
    // Fine step back to the exact budget edge.
    while (hardEnd < total && len(text.slice(start, hardEnd + 1)) <= budget) hardEnd++;
    hardEnd = Math.max(start + 1, Math.min(total, hardEnd));

    const reachesEnd = hardEnd >= total;
    // Floor keeps a chunk from collapsing to almost nothing when a separator sits early.
    const floor = start + Math.floor((hardEnd - start) * 0.5);
    const end = reachesEnd ? total : findBreak(text, floor, hardEnd);

    const body = text.slice(start, end);
    if (body.trim().length > 0) chunks.push({ body, charStart: start, charEnd: end });

    if (end >= total) break;
    // Advance with overlap, but always make forward progress.
    const next = end - overlap;
    start = next > start ? next : end;
  }

  return chunks;
}
