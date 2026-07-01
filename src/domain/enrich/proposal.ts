// Build a recovery proposal by diffing external provider hits against the current book.
// Conservative by design: only fills fields that are MISSING or WEAK on the current record
// (never clobbers good data), and only emits allowlisted calibre_update_book fields so the
// `changes` object can be applied as-is. Pure, SDK-free, unit-tested.

import type { Book } from "../book.js";
import type { ChangeValue } from "../../calibre/metadata-fields.js";
import { isAllowedField } from "../../calibre/metadata-fields.js";
import { looksLikeRawFilename } from "./filename-guess.js";
import type { ProposedField, Proposal, ProviderHit } from "./types.js";

const UNKNOWN_AUTHOR = new Set(["", "unknown", "unknown author"]);

/** A title is weak if it's missing or a raw import filename. */
function titleIsWeak(title: string): boolean {
  return title.trim().length === 0 || looksLikeRawFilename(title);
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

/**
 * Diff the best hit against `current` and produce a proposal. Fields are proposed only when
 * the current value is missing/weak; identifiers add a new isbn only when the book has none.
 */
export function buildProposal(current: Book, hits: ProviderHit[]): Proposal {
  const hit = pickBestHit(hits);
  const fields: ProposedField[] = [];
  const changes: Record<string, ChangeValue> = {};
  if (!hit) return { fields, changes };

  const add = (field: string, current: unknown, proposed: ChangeValue, reason: ProposedField["reason"]) => {
    if (!isAllowedField(field)) return; // safety net — only writable fields reach `changes`
    fields.push({ field, current, proposed, source: hit.source, confidence: hit.confidence, reason });
    changes[field] = proposed;
  };

  if (hit.title && titleIsWeak(current.title)) {
    add("title", current.title || undefined, hit.title, current.title.trim() ? "weak" : "missing");
  }
  if (hit.authors?.length && authorsAreWeak(current.authors)) {
    add("authors", current.authors.length ? current.authors : undefined, hit.authors,
      current.authors.length ? "weak" : "missing");
  }
  if (hit.publisher && !current.publisher) {
    add("publisher", undefined, hit.publisher, "missing");
  }
  if (hit.pubdate && !current.pubdate) {
    add("pubdate", undefined, hit.pubdate, "missing");
  }
  if (hit.series && !current.series) {
    add("series", undefined, hit.series, "missing");
  }
  // Only ADD an isbn when the book carries none — never overwrite an existing identifier.
  if (hit.isbn && !current.identifiers.isbn) {
    add("identifiers", undefined, { isbn: hit.isbn }, "missing");
  }

  return { fields, changes };
}
