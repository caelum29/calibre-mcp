// Scan raw book text for ISBN candidates. Clean-room: an independent regex sweep (labeled
// ISBNs first, then bare 10/13-digit runs) filtered by the checksum validators in
// curation/isbn.ts — NOT a port of Calibre's GPL ISBN extraction. The checksum is the real
// filter: a random digit run almost never passes ISBN-10/13 validation.
//
// Ranking/guards mirror the *behaviour* of the kiwidude Extract-ISBN plugin (algorithm only,
// reimplemented): prefer ISBN-13 over ISBN-10, require a real Bookland prefix (977/978/979) on
// 13-digit runs, and reject all-same-digit runs (e.g. "1111111111" — which DOES pass the
// ISBN-10 checksum). Labeled-first stays the primary key; the 13-over-10 preference is secondary.

import { isValidIsbn, normalizeIsbn } from "../curation/isbn.js";

// Labeled: "ISBN", optional "-13"/"13", optional colon, then a digit/space/hyphen run.
const LABELED = /ISBN(?:[-\s]?1[03])?\s*:?\s*([0-9][0-9\s-]{8,18}[0-9Xx])/gi;
// Bare: an optional 978/979 prefix + a hyphen/space-tolerant 10/13-ish run at a word boundary.
const BARE = /\b((?:97[89][\s-]?)?[0-9][0-9\s-]{8,16}[0-9Xx])\b/g;
// Bookland / ISSN prefixes that a legitimate ISBN-13 begins with (kiwidude default set). This
// default covers every ISBN in circulation; the `prefixes` option on extractIsbns is an internal
// test/future seam (a new GS1 prefix is a decades-away, one-line change), not a user-facing knob.
export const DEFAULT_ISBN13_PREFIXES: ReadonlySet<string> = new Set(["977", "978", "979"]);

/** Tuning knobs for {@link extractIsbns}. */
export interface ExtractIsbnOptions {
  /** Allowed 3-digit ISBN-13 prefixes; defaults to the Bookland set (977/978/979). */
  prefixes?: Iterable<string>;
  /**
   * Trust only explicitly labeled "ISBN …" matches, skipping bare digit runs. Bare runs risk
   * false positives so the caller caps them to front/tail slices; a labeled token is safe to
   * sweep across the whole book (see isbn-scan.ts's middle sweep).
   */
  labeledOnly?: boolean;
}

interface Candidate {
  isbn: string;
  labeled: boolean;
  isbn13: boolean;
}

/**
 * A normalized ISBN is plausible if it's checksum-valid AND not a degenerate run. Guards on top
 * of the checksum: all-same-digit strings pass the ISBN-10 checksum but are never real, and a
 * 13-digit run must carry an allowed prefix (Bookland 977/978/979 by default) to be an ISBN
 * rather than a stray EAN.
 */
function plausibleIsbn(norm: string, prefixes: ReadonlySet<string>): boolean {
  if (norm.length !== 10 && norm.length !== 13) return false;
  if (/^(\d)\1+$/.test(norm)) return false; // 1111111111 / 0000000000 etc.
  if (norm.length === 13 && !prefixes.has(norm.slice(0, 3))) return false;
  return isValidIsbn(norm);
}

/**
 * Extract unique, plausible ISBNs from `text`. Ranked labeled-first, then ISBN-13 before
 * ISBN-10, then by appearance. Returns normalized (hyphen/space-stripped, upper-case X)
 * ISBN-10/13 strings, up to `limit`. `opts` tunes the allowed prefixes and labeled-only scanning.
 */
export function extractIsbns(text: string, limit = 5, opts: ExtractIsbnOptions = {}): string[] {
  const prefixes = opts.prefixes ? new Set(opts.prefixes) : DEFAULT_ISBN13_PREFIXES;
  const sources: Array<[RegExp, boolean]> = opts.labeledOnly
    ? [[LABELED, true]]
    : [
        [LABELED, true],
        [BARE, false],
      ];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const [re, labeled] of sources) {
    for (const m of text.matchAll(re)) {
      const norm = normalizeIsbn(m[1]!);
      if (plausibleIsbn(norm, prefixes) && !seen.has(norm)) {
        seen.add(norm);
        candidates.push({ isbn: norm, labeled, isbn13: norm.length === 13 });
      }
    }
  }
  // Stable sort (V8): labeled beats bare, then 13 beats 10, appearance order kept within ties.
  candidates.sort((a, b) => Number(b.labeled) - Number(a.labeled) || Number(b.isbn13) - Number(a.isbn13));
  return candidates.slice(0, limit).map((c) => c.isbn);
}
