// Build a recovery proposal by diffing external provider hits against the current book.
// Conservative by design: only fills fields that are MISSING or WEAK on the current record
// (never clobbers good data), and only emits allowlisted calibre_update_book fields so the
// `changes` object can be applied as-is. Pure, SDK-free, unit-tested.

import type { Book } from "../book.js";
import type { ChangeValue } from "../../calibre/metadata-fields.js";
import { isAllowedField } from "../../calibre/metadata-fields.js";
import { authorSuspectReason, normalizeAuthors } from "../curation/authors.js";
import { foldAccents } from "../curation/normalize.js";
import { toIsbn13 } from "../curation/isbn.js";
import { isEmptyDate } from "../merge.js";
import { looksLikeRawFilename } from "./filename-guess.js";
import type { ProposedField, Proposal, ProviderHit } from "./types.js";

const UNKNOWN_AUTHOR = new Set(["", "unknown", "unknown author"]);
// Two shared significant words = same book unless one title is a subset of the other.
const MIN_SHARED_WORDS = 2;
// Function words carry no title identity; counting them would inflate or dilute the overlap.
const STOP_WORDS = new Set(
  // EN, then RU
  ["the", "a", "an", "of", "and", "for", "in", "on", "to", "with", "и", "в", "на", "для", "с", "по"],
);
// Below any provider's fuzzy-search score (0.6): a contradicted ISBN hit is the least trustworthy.
const MISMATCH_CONFIDENCE = 0.3;

/** A title is weak if it's missing or a raw import filename. */
function titleIsWeak(title: string, authors: string[]): boolean {
  return title.trim().length === 0 || looksLikeRawFilename(title, authors);
}

/**
 * Authors are weak if empty, only the "Unknown" placeholder Calibre assigns on import, or EVERY
 * remaining entry is suspect — a glued list, an unflipped "Last, First", or junk like "2007" (#201).
 * A mixed list keeps its real names, so it is never replaced wholesale.
 */
function authorsAreWeak(authors: string[]): boolean {
  const real = authors.filter((a) => !UNKNOWN_AUTHOR.has(a.trim().toLowerCase()));
  return real.every((a) => authorSuspectReason(a) !== undefined);
}

/** True if the publisher value is just author name(s) — a provider field mix-up (#201). */
function publisherIsAuthors(publisher: string, authors: string[]): boolean {
  const known = new Set(normalizeAuthors(authors).map((a) => a.toLowerCase()));
  const names = normalizeAuthors([publisher]);
  return names.length > 0 && names.every((n) => known.has(n.toLowerCase()));
}

/** Pick the highest-confidence hit (stable — first wins on ties). */
export function pickBestHit(hits: ProviderHit[]): ProviderHit | undefined {
  let best: ProviderHit | undefined;
  for (const h of hits) if (!best || h.confidence > best.confidence) best = h;
  return best;
}

/** Significant title words: accent/case/punctuation-insensitive, EN/RU stop-words dropped. */
function titleWords(title: string): Set<string> {
  const words = foldAccents(title.toLowerCase())
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((w) => w && !STOP_WORDS.has(w));
  return new Set(words);
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

/**
 * True if two titles plausibly name the same book: one title's significant words are a subset
 * of the other's (subtitle / edition suffix), or they share at least 2 significant words. A
 * single shared word is often generic ("Python") and two different books can share it (#198).
 */
export function titlesAgree(a: string, b: string): boolean {
  const wa = titleWords(a);
  const wb = titleWords(b);
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (small.size === 0) return true; // nothing to compare → no evidence of a mismatch
  if (isSubset(small, big)) return true;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared >= MIN_SHARED_WORDS;
}

/**
 * An ISBN can belong to another book (ad pages, #198); a real current title that disagrees with
 * the provider's is the tell, so cap the confidence and warn.
 */
function crossCheckTitle(current: Book, hit: ProviderHit): { confidence: number; warnings: string[] } {
  if (!hit.title || titleIsWeak(current.title, current.authors) || titlesAgree(current.title, hit.title)) {
    return { confidence: hit.confidence, warnings: [] };
  }
  return {
    confidence: Math.min(hit.confidence, MISMATCH_CONFIDENCE),
    warnings: [
      `title mismatch: the book is "${current.title}" but ${hit.source} returned "${hit.title}" — ` +
        `the ISBN may belong to another book; verify before applying.`,
    ],
  };
}

/**
 * Diff the best hit against `current` and produce a proposal. Fields are proposed only when
 * the current value is missing/weak; identifiers add a new isbn only when the book has none.
 * A hit whose title contradicts a real current title gets its confidence capped + a warning.
 */
export function buildProposal(current: Book, hits: ProviderHit[]): Proposal {
  const hit = pickBestHit(hits);
  const fields: ProposedField[] = [];
  const changes: Record<string, ChangeValue> = {};
  if (!hit) return { fields, changes };

  const { confidence, warnings } = crossCheckTitle(current, hit);

  const add = (field: string, current: unknown, proposed: ChangeValue, reason: ProposedField["reason"]) => {
    if (!isAllowedField(field)) return; // safety net — only writable fields reach `changes`
    fields.push({ field, current, proposed, source: hit.source, confidence, reason });
    changes[field] = proposed;
  };

  if (hit.title && titleIsWeak(current.title, current.authors)) {
    add("title", current.title || undefined, hit.title, current.title.trim() ? "weak" : "missing");
  }
  // Providers return "Last, First" or glued strings; Calibre wants one "First Last" per entry.
  const hitAuthors = normalizeAuthors(hit.authors ?? []);
  if (hitAuthors.length && authorsAreWeak(current.authors)) {
    add(
      "authors",
      current.authors.length ? current.authors : undefined,
      hitAuthors,
      current.authors.length ? "weak" : "missing",
    );
  }
  if (hit.publisher && !current.publisher && !publisherIsAuthors(hit.publisher, [...hitAuthors, ...current.authors])) {
    add("publisher", undefined, hit.publisher, "missing");
  }
  // Calibre stores "no date" as the 0101-01-01 sentinel, a non-empty string
  if (hit.pubdate && isEmptyDate(current.pubdate)) {
    add("pubdate", undefined, hit.pubdate, "missing");
  }
  if (hit.series && !current.series) {
    add("series", undefined, hit.series, "missing");
  }
  // Only ADD an isbn when the book carries none — never overwrite an existing identifier.
  if (hit.isbn && !current.identifiers.isbn) {
    // Always ISBN-13 so the stored identifier matches the lookup key's form (#201).
    add("identifiers", undefined, { isbn: toIsbn13(hit.isbn) }, "missing");
  }

  return { fields, changes, confidence, warnings };
}
