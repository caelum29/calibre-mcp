// Scan raw book text for ISBN candidates. Clean-room: an independent regex sweep (labeled
// ISBNs first, then bare 10/13-digit runs) filtered by the checksum validators in
// curation/isbn.ts — NOT a port of Calibre's GPL ISBN extraction. The checksum is the real
// filter: a random digit run almost never passes ISBN-10/13 validation.
//
// Ranking/guards mirror the *behaviour* of the kiwidude Extract-ISBN plugin (algorithm only,
// reimplemented): prefer ISBN-13 over ISBN-10, require a real Bookland prefix (977/978/979) on
// 13-digit runs, and reject all-same-digit runs (e.g. "1111111111" — which DOES pass the
// ISBN-10 checksum). Labeled-first stays the primary key; the 13-over-10 preference is secondary.
// ISBNs in publisher ad/catalog listings (other books' entries) are dropped (#198).

import { isValidIsbn, normalizeIsbn } from "../curation/isbn.js";

// Labeled: "ISBN", optional "-13"/"13", optional colon, then a digit/space/hyphen run.
const LABELED = /ISBN(?:[-\s]?1[03])?\s*:?\s*([0-9][0-9\s-]{8,18}[0-9Xx])/gi;
// Bare: an optional 978/979 prefix + a hyphen/space-tolerant 10/13-ish run at a word boundary.
const BARE = /\b((?:97[89][\s-]?)?[0-9][0-9\s-]{8,16}[0-9Xx])\b/g;
// Bookland / ISSN prefixes that a legitimate ISBN-13 begins with (kiwidude default set). This
// default covers every ISBN in circulation; the `prefixes` option on extractIsbns is an internal
// test/future seam (a new GS1 prefix is a decades-away, one-line change), not a user-facing knob.
export const DEFAULT_ISBN13_PREFIXES: ReadonlySet<string> = new Set(["977", "978", "979"]);
// Publisher ad pages ("You May Be Interested In…") list other titles as
// "(218 pages) ISBN: 9781680502442 $45.95" — a page count just before the ISBN marks an ad (#198).
const AD_PAGE_COUNT = /\(\d+\s*pages?\)[^\n]{0,30}$/i;
const AD_LOOKBEHIND = 40;
// A price right after the ISBN. One alone is a back cover; two in a short window is a catalog.
const PRICE_AFTER = /^\s{0,3}[$€£]\s?\d/;
const CATALOG_WINDOW = 1500;

/** Tuning knobs for {@link extractIsbns}. */
export interface ExtractIsbnOptions {
  /** Allowed 3-digit ISBN-13 prefixes; defaults to the Bookland set (977/978/979). */
  prefixes?: Iterable<string>;
  /**
   * Trust only explicitly labeled "ISBN …" matches, skipping bare digit runs. Bare runs risk
   * false positives so the caller caps them to front/tail slices; a labeled token is safe to
   * sweep across the whole book (see app/isbn-scan.ts's middle sweep).
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
 * ISBNs that sit in another title's ad/catalog entry: preceded by a "(NNN pages)" count, or
 * price-tagged next to another distinct price-tagged ISBN within CATALOG_WINDOW chars.
 */
function adIsbns(matches: { isbn: string; start: number; end: number }[], text: string): Set<string> {
  const ads = new Set<string>();
  const priced: { isbn: string; start: number }[] = [];
  for (const m of matches) {
    if (AD_PAGE_COUNT.test(text.slice(Math.max(0, m.start - AD_LOOKBEHIND), m.start))) ads.add(m.isbn);
    if (PRICE_AFTER.test(text.slice(m.end, m.end + 15))) priced.push(m);
  }
  for (const a of priced) {
    if (priced.some((b) => b.isbn !== a.isbn && Math.abs(b.start - a.start) <= CATALOG_WINDOW)) ads.add(a.isbn);
  }
  return ads;
}

/**
 * Extract unique, plausible ISBNs from `text`. Ranked labeled-first, then ISBN-13 before
 * ISBN-10, then by appearance. Returns normalized (hyphen/space-stripped, upper-case X)
 * ISBN-10/13 strings, up to `limit`. `opts` tunes the allowed prefixes and labeled-only scanning.
 * ISBNs from ad/catalog listings (another book's entry) are dropped wherever they appear.
 */
export function extractIsbns(text: string, limit = 5, opts: ExtractIsbnOptions = {}): string[] {
  const prefixes = opts.prefixes ? new Set(opts.prefixes) : DEFAULT_ISBN13_PREFIXES;
  const sources: Array<[RegExp, boolean]> = opts.labeledOnly
    ? [[LABELED, true]]
    : [
        [LABELED, true],
        [BARE, false],
      ];
  const matches: { isbn: string; labeled: boolean; start: number; end: number }[] = [];
  for (const [re, labeled] of sources) {
    for (const m of text.matchAll(re)) {
      const norm = normalizeIsbn(m[1]!);
      if (!plausibleIsbn(norm, prefixes)) continue;
      // Measure from the ISBN digits themselves, so a "ISBN:" label sits inside the lookbehind.
      const start = m.index + m[0].lastIndexOf(m[1]!);
      matches.push({ isbn: norm, labeled, start, end: start + m[1]!.length });
    }
  }
  const ads = adIsbns(matches, text);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (ads.has(m.isbn) || seen.has(m.isbn)) continue;
    seen.add(m.isbn);
    candidates.push({ isbn: m.isbn, labeled: m.labeled, isbn13: m.isbn.length === 13 });
  }
  // Stable sort (V8): labeled beats bare, then 13 beats 10, appearance order kept within ties.
  candidates.sort((a, b) => Number(b.labeled) - Number(a.labeled) || Number(b.isbn13) - Number(a.isbn13));
  return candidates.slice(0, limit).map((c) => c.isbn);
}
