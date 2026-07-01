// Scan raw book text for ISBN candidates. Clean-room: an independent regex sweep (labeled
// ISBNs first, then bare 10/13-digit runs) filtered by the checksum validators in
// curation/isbn.ts — NOT a port of Calibre's GPL ISBN extraction. The checksum is the real
// filter: a random digit run almost never passes ISBN-10/13 validation.

import { isValidIsbn, normalizeIsbn } from "../curation/isbn.js";

// Labeled: "ISBN", optional "-13"/"13", optional colon, then a digit/space/hyphen run.
const LABELED = /ISBN(?:[-\s]?1[03])?\s*:?\s*([0-9][0-9\s-]{8,18}[0-9Xx])/gi;
// Bare: an optional 978/979 prefix + a hyphen/space-tolerant 10/13-ish run at a word boundary.
const BARE = /\b((?:97[89][\s-]?)?[0-9][0-9\s-]{8,16}[0-9Xx])\b/g;

/**
 * Extract unique, checksum-valid ISBNs from `text`, ranked labeled-first then by appearance.
 * Returns normalized (hyphen/space-stripped, upper-case X) ISBN-10/13 strings, up to `limit`.
 */
export function extractIsbns(text: string, limit = 5): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const re of [LABELED, BARE]) {
    for (const m of text.matchAll(re)) {
      const norm = normalizeIsbn(m[1]!);
      if ((norm.length === 10 || norm.length === 13) && isValidIsbn(norm) && !seen.has(norm)) {
        seen.add(norm);
        found.push(norm);
        if (found.length >= limit) return found;
      }
    }
  }
  return found;
}
