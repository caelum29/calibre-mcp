// Build a recovery proposal by diffing external provider hits against the current book.
// Conservative by design: only fills fields that are MISSING or WEAK on the current record
// (never clobbers good data), and only emits allowlisted calibre_update_book fields so the
// `changes` object can be applied as-is. Pure, SDK-free, unit-tested.

import type { Book } from "../book.js";
import type { ChangeValue } from "../../calibre/metadata-fields.js";
import { isAllowedField } from "../../calibre/metadata-fields.js";
import { isEmptyDate } from "../merge.js";
import { looksLikeRawFilename } from "./filename-guess.js";
import type { ProposedField, Proposal, ProviderHit } from "./types.js";

const UNKNOWN_AUTHOR = new Set(["", "unknown", "unknown author"]);
const ARTICLES = new Set(["the", "a", "an"]);
// Below any provider's fuzzy-search score (0.6): a contradicted ISBN hit is the least trustworthy.
const MISMATCH_CONFIDENCE = 0.3;

/** A title is weak if it's missing or a raw import filename. */
function titleIsWeak(title: string, authors: string[]): boolean {
  return title.trim().length === 0 || looksLikeRawFilename(title, authors);
}

/** Authors are weak if empty or the "Unknown" placeholder Calibre assigns on import. */
function authorsAreWeak(authors: string[]): boolean {
  const real = authors.filter((a) => !UNKNOWN_AUTHOR.has(a.trim().toLowerCase()));
  return real.length === 0;
}

/** Pick the highest-confidence hit (stable — first wins on ties). */
export function pickBestHit(hits: ProviderHit[]): ProviderHit | undefined {
  let best: ProviderHit | undefined;
  for (const h of hits) if (!best || h.confidence > best.confidence) best = h;
  return best;
}

/** Title words for comparison: accent/case/punctuation-insensitive, articles dropped. */
function titleWords(title: string): Set<string> {
  const words = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !ARTICLES.has(w));
  return new Set(words);
}

/**
 * True if two titles plausibly name the same book: at least half the words of the shorter
 * title appear in the other. Tolerates an added subtitle ("X" vs "X: Simple, Rapid…").
 */
export function titlesAgree(a: string, b: string): boolean {
  const wa = titleWords(a);
  const wb = titleWords(b);
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (small.size === 0) return true; // nothing to compare → no evidence of a mismatch
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / small.size >= 0.5;
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

  // An ISBN can belong to another book (ad pages, #198); a real title that disagrees with the
  // provider's is the tell, so the proposal must not look trustworthy.
  const warnings: string[] = [];
  let confidence = hit.confidence;
  if (hit.title && !titleIsWeak(current.title, current.authors) && !titlesAgree(current.title, hit.title)) {
    confidence = Math.min(confidence, MISMATCH_CONFIDENCE);
    warnings.push(
      `title mismatch: the book is "${current.title}" but ${hit.source} returned "${hit.title}" — ` +
        `the ISBN may belong to another book; verify before applying.`,
    );
  }

  const add = (field: string, current: unknown, proposed: ChangeValue, reason: ProposedField["reason"]) => {
    if (!isAllowedField(field)) return; // safety net — only writable fields reach `changes`
    fields.push({ field, current, proposed, source: hit.source, confidence, reason });
    changes[field] = proposed;
  };

  if (hit.title && titleIsWeak(current.title, current.authors)) {
    add("title", current.title || undefined, hit.title, current.title.trim() ? "weak" : "missing");
  }
  if (hit.authors?.length && authorsAreWeak(current.authors)) {
    add(
      "authors",
      current.authors.length ? current.authors : undefined,
      hit.authors,
      current.authors.length ? "weak" : "missing",
    );
  }
  if (hit.publisher && !current.publisher) {
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
    add("identifiers", undefined, { isbn: hit.isbn }, "missing");
  }

  return { fields, changes, confidence, warnings };
}
