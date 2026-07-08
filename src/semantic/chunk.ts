// Splits a book's extracted text into consecutive windows for embedding. Distinct from
// content-chunk.ts (single cursor-walked page) — this yields the FULL array of chunks with
// recovered char offsets, which become each vector's {char_start, char_end} location
// (pairs with calibre_get_content offsets).
//
// v3: overlap defaults to 0 — two independent 2025-26 ablations (arXiv 2601.14123; the
// late-chunking paper) found overlap gives no retrieval benefit while inflating chunk count
// by 1/(1−o) (~13% at our old 120/900). The mechanism stays for callers that opt in.
// Budgets are measured through the `lengthFn` seam: callers with a loaded model pass the
// real tokenizer (see calibre_build_index) so the budget is model tokens, not the v1
// conservative ~900-char guess; keyword-only builds keep the char default (no token window).

/** One chunk with its character span in the original text. */
export interface EmbedChunk {
  body: string;
  charStart: number;
  charEnd: number;
}

export interface ChunkForEmbeddingOptions {
  /** Target chunk size (in `lengthFn` units, default characters). */
  budget?: number;
  /** Overlap carried between consecutive chunks, in CHARACTERS (the recede is positional). */
  overlap?: number;
  /**
   * Length function — defaults to character count; the token-budgeting seam. Must be
   * monotone non-decreasing in slice length (true for chars and real tokenizers): the
   * interpolation-guided budget probe (see `budgetEnd`) relies on that assumption.
   */
  lengthFn?: (s: string) => number;
}

const DEFAULT_BUDGET = 900;
// 0 since v3 — overlap measured as pure cost (no retrieval gain, +13% chunks at 120/900).
const DEFAULT_OVERLAP = 0;

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

/** After this many interpolation probes, fall back to bisection (bounds the worst case). */
const INTERPOLATION_PROBES = 4;

/** Accept a within-budget probe this full — chasing the exact edge isn't worth extra calls. */
const ACCEPT_FRACTION = 0.95;

/**
 * An end offset in `(start, ceil]` whose slice from `start` fills `budget` `len` units
 * ≥95% (or is provably maximal), assuming `len` is monotone in slice length. Probes are
 * interpolation-guided: `hint` (chars per `len` unit, carried across chunks) puts the first
 * guess near the budget edge, so a near-linear `len` — chars, real tokenizers — usually
 * accepts in 1-2 calls; a bisection fallback keeps the worst case at O(log n) calls. This
 * matters because a real tokenizer costs ~ms per call: a fixed-bracket binary search
 * measured ~13 calls/chunk (~190s to chunk a 600k-char book) vs ~1-2 interpolated calls.
 * Exact for the identity `len` (first guess IS the edge). Returns at least `start + 1`
 * (forward progress even when one char busts the budget).
 */
function budgetEnd(
  text: string,
  start: number,
  ceil: number,
  budget: number,
  len: (s: string) => number,
  hint: number,
): { end: number; charsPerUnit: number } {
  let lo = start; // largest end known to fit (the empty slice fits trivially)
  let loUnits = 0;
  let hi = ceil + 1; // smallest end known to bust (ceil+1 = "none found yet")
  let guess = Math.min(Math.max(start + Math.round(budget * hint), start + 1), ceil);

  for (let probes = 1; lo + 1 < hi; probes++) {
    const units = len(text.slice(start, guess));
    if (units <= budget) {
      lo = guess;
      loUnits = units;
      if (units >= budget * ACCEPT_FRACTION) break; // full enough — stop probing
    } else {
      hi = guess;
    }
    if (lo + 1 >= hi) break;
    // Next probe: project the budget through the measured density, then clamp strictly
    // inside the open bracket so the interval shrinks every iteration (no repeats).
    const density = units > 0 ? (guess - start) / units : hint;
    const next =
      probes < INTERPOLATION_PROBES ? start + Math.round(budget * density) : lo + ((hi - lo) >> 1);
    guess = Math.min(Math.max(next, lo + 1), hi - 1);
  }

  return {
    end: Math.max(lo, start + 1),
    charsPerUnit: loUnits > 0 ? (lo - start) / loUnits : hint,
  };
}

/**
 * Chunk `text` into consecutive (optionally overlapping) windows. Offsets are exact
 * positions in the ORIGINAL text regardless of what `lengthFn` counts (so callers can
 * re-slice via calibre_get_content). Whitespace-only tail chunks are dropped.
 */
export function chunkForEmbedding(text: string, opts: ChunkForEmbeddingOptions = {}): EmbedChunk[] {
  const budget = Math.max(1, Math.trunc(opts.budget ?? DEFAULT_BUDGET));
  const overlap = Math.max(0, Math.min(Math.trunc(opts.overlap ?? DEFAULT_OVERLAP), budget - 1));
  const len = opts.lengthFn ?? ((s: string) => s.length);
  const total = text.length;
  if (total === 0) return [];

  const chunks: EmbedChunk[] = [];
  let start = 0;
  // Chars-per-unit calibration for the probe, refined chunk over chunk (1 = char default).
  let charsPerUnit = 1;

  while (start < total) {
    // Char ceiling for the probe — generous for token lengthFns (clean EN prose runs
    // ~4-6 chars/token, so budget*8 chars comfortably brackets the budget edge).
    const ceil = Math.min(total, start + budget * 8);
    const probed = budgetEnd(text, start, ceil, budget, len, charsPerUnit);
    const hardEnd = probed.end;
    charsPerUnit = probed.charsPerUnit;

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
