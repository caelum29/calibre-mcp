// Duplicate detection + merge-safety scoring. Pure, SDK-free, clean-room reimplementation
// of the Find-Duplicates plugin's grouping idea (GPL — algorithm reimplemented from
// documented behavior, not translated). mergeSafety is our own heuristic: it never merges,
// it only scores how safe a human/agent merge would be so conflicts surface first.

import type { Book } from "../book.js";
import { identicalKey, similarKey } from "./normalize.js";

export type DuplicateMode = "identical" | "similar";

/** A set of books that share a normalized key, with a merge-safety score in [0,1]. */
export interface DupGroup {
  key: string;
  books: Book[];
  /** 1 = safe to merge (consistent metadata); lower = conflicts that need review. */
  mergeSafety: number;
}

/** Distinct, non-empty ISBNs present across a group. */
function distinctIsbns(books: Book[]): Set<string> {
  const out = new Set<string>();
  for (const b of books) {
    const isbn = b.identifiers.isbn?.trim();
    if (isbn) out.add(isbn.toLowerCase());
  }
  return out;
}

/** Distinct language codes across a group. */
function distinctLanguages(books: Book[]): Set<string> {
  const out = new Set<string>();
  for (const b of books) for (const l of b.languages) if (l) out.add(l.toLowerCase());
  return out;
}

/** True if any format value appears in more than one book (can't byte-compare via /ajax). */
function hasSharedFormat(books: Book[]): boolean {
  const seen = new Set<string>();
  for (const b of books) {
    const uniq = new Set(b.formats.map((f) => f.toLowerCase()));
    for (const f of uniq) {
      if (seen.has(f)) return true;
      seen.add(f);
    }
  }
  return false;
}

/**
 * Merge-safety score for a candidate duplicate set. Starts at 1.0 and deducts for signals
 * that two records might NOT be the same edition (distinct ISBNs), can't be losslessly
 * merged (multiple languages), or hide a real content difference we can't inspect
 * (the same format in >1 book). Clamped to [0,1]. Higher = safer.
 */
export function mergeSafety(books: Book[]): number {
  let score = 1;
  if (distinctIsbns(books).size > 1) score -= 0.5;
  if (distinctLanguages(books).size > 1) score -= 0.3;
  if (hasSharedFormat(books)) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

/**
 * Group books that share a normalized key (identical = exact-ish, similar = fuzzy). Only
 * groups of >1 are returned, sorted least-safe-first so risky merges surface at the top.
 */
export function findDuplicateGroups(books: Book[], mode: DuplicateMode): DupGroup[] {
  const keyOf = mode === "identical" ? identicalKey : similarKey;
  const buckets = new Map<string, Book[]>();
  for (const b of books) {
    const key = keyOf(b);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(b);
    else buckets.set(key, [b]);
  }

  const groups: DupGroup[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    groups.push({ key, books: members, mergeSafety: mergeSafety(members) });
  }
  // Least safe first; ties broken by larger group.
  groups.sort((a, b) => a.mergeSafety - b.mergeSafety || b.books.length - a.books.length);
  return groups;
}

/** Per-field diff across an explicit set of books. */
export interface FieldDiff {
  field: string;
  /** Distinct values (missing rendered as "∅") in book order. */
  values: string[];
  agree: boolean;
}

/** Result of comparing an explicit set of books for a merge decision. */
export interface ComparisonReport {
  bookIds: number[];
  diffs: FieldDiff[];
  mergeSafety: number;
  /** Book id recommended to keep (most complete record). */
  keep: number;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null || v === "") return "∅";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "∅";
  return String(v);
}

/** Completeness score: more formats + identifiers + filled fields = better keep candidate. */
function completeness(b: Book): number {
  let s = b.formats.length + Object.keys(b.identifiers).length;
  for (const v of [b.authorSort, b.series, b.publisher, b.pubdate, b.comments]) if (v) s += 1;
  if (b.tags.length) s += 1;
  if (b.languages.length) s += 1;
  return s;
}

/**
 * Field-by-field comparison of an explicit book set + a keep recommendation. Used by the
 * `compare` mode where the caller already picked the records to inspect.
 */
export function compareBooks(books: Book[]): ComparisonReport {
  const fields: { field: string; pick: (b: Book) => unknown }[] = [
    { field: "title", pick: (b) => b.title },
    { field: "authors", pick: (b) => b.authors },
    { field: "isbn", pick: (b) => b.identifiers.isbn },
    { field: "formats", pick: (b) => b.formats },
    { field: "publisher", pick: (b) => b.publisher },
    { field: "pubdate", pick: (b) => b.pubdate },
    { field: "series", pick: (b) => (b.series ? `${b.series} #${b.seriesIndex ?? "?"}` : undefined) },
  ];

  const diffs: FieldDiff[] = fields.map(({ field, pick }) => {
    const values = books.map((b) => fmt(pick(b)));
    return { field, values, agree: new Set(values).size <= 1 };
  });

  let keep = books[0]!;
  for (const b of books) if (completeness(b) > completeness(keep)) keep = b;

  return {
    bookIds: books.map((b) => b.id),
    diffs,
    mergeSafety: mergeSafety(books),
    keep: keep.id,
  };
}
