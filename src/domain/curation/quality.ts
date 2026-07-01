// Metadata quality checks. Pure, SDK-free, clean-room reimplementation of the Quality-Check
// plugin's rule ideas (GPL — reimplemented from documented behavior, not translated). Cheap,
// metadata-only rules that run library-wide; full-text checks (readability) are deferred.

import type { Book } from "../book.js";
import { isValidIsbn } from "./isbn.js";
import { authorToAuthorSort } from "./normalize.js";

export type QualityCheck =
  | "missing_metadata"
  | "raw_filename_title"
  | "isbn_invalid"
  | "author_sort_mismatch"
  | "series_gaps";

export const ALL_CHECKS: QualityCheck[] = [
  "missing_metadata",
  "raw_filename_title",
  "isbn_invalid",
  "author_sort_mismatch",
  "series_gaps",
];

export interface Issue {
  bookId: number;
  title: string;
  check: QualityCheck;
  severity: "info" | "warn";
  message: string;
}

/** Author list is effectively empty (unset or the Calibre "Unknown" placeholder). */
function authorsMissing(book: Book): boolean {
  const real = book.authors.filter((a) => a && a.trim().toLowerCase() !== "unknown");
  return real.length === 0;
}

/** Aggregate the missing-field check into one issue per book. */
function checkMissingMetadata(book: Book): Issue | undefined {
  const missing: string[] = [];
  if (authorsMissing(book)) missing.push("authors");
  if (!book.pubdate) missing.push("pubdate");
  if (!book.publisher) missing.push("publisher");
  if (book.tags.length === 0) missing.push("tags");
  if (Object.keys(book.identifiers).length === 0) missing.push("identifiers");
  if (missing.length === 0) return undefined;
  return {
    bookId: book.id,
    title: book.title,
    check: "missing_metadata",
    severity: "warn",
    message: `Missing metadata: ${missing.join(", ")}.`,
  };
}

const ASIN_RE = /^B0[A-Z0-9]{8}$/;
const EXT_RE = /\.(pdf|epub|mobi|azw3?|dvi|djvu|txt|doc|docx|fb2|cbz|cbr|rtf)$/i;

/** Title looks like a leftover filename/identifier rather than a real title. */
function checkRawFilenameTitle(book: Book): Issue | undefined {
  const t = book.title.trim();
  if (!t) return undefined;
  const isDigits = /^\d+$/.test(t);
  const isAsin = ASIN_RE.test(t);
  const isFile = EXT_RE.test(t);
  if (!isDigits && !isAsin && !isFile) return undefined;
  return {
    bookId: book.id,
    title: book.title,
    check: "raw_filename_title",
    severity: "warn",
    message: "Title looks like a raw filename/identifier; run calibre_recover_metadata.",
  };
}

/** ISBN present but fails the checksum. */
function checkIsbnInvalid(book: Book): Issue | undefined {
  const isbn = book.identifiers.isbn?.trim();
  if (!isbn || isValidIsbn(isbn)) return undefined;
  return {
    bookId: book.id,
    title: book.title,
    check: "isbn_invalid",
    severity: "warn",
    message: `ISBN "${isbn}" is not a valid ISBN-10/13 (checksum fails).`,
  };
}

/** author_sort disagrees with the derived "Last, First & …" form (heuristic — approximate). */
function checkAuthorSortMismatch(book: Book): Issue | undefined {
  if (!book.authorSort || authorsMissing(book)) return undefined;
  const expected = book.authors.map(authorToAuthorSort).join(" & ");
  if (expected.toLowerCase() === book.authorSort.trim().toLowerCase()) return undefined;
  return {
    bookId: book.id,
    title: book.title,
    check: "author_sort_mismatch",
    severity: "info",
    message: `author_sort "${book.authorSort}" ≠ expected "${expected}" (heuristic — verify).`,
  };
}

/**
 * Per-series gap detection: books in a series with missing integer indices or duplicate
 * indices. One issue per affected series, attributed to the lowest-id book in it.
 */
function checkSeriesGaps(books: Book[]): Issue[] {
  const bySeries = new Map<string, Book[]>();
  for (const b of books) {
    if (!b.series || b.seriesIndex === undefined) continue;
    const arr = bySeries.get(b.series);
    if (arr) arr.push(b);
    else bySeries.set(b.series, [b]);
  }

  const issues: Issue[] = [];
  for (const [series, members] of bySeries) {
    if (members.length < 2) continue;
    const indices = members.map((b) => b.seriesIndex!).sort((a, b) => a - b);
    const ints = indices.filter((n) => Number.isInteger(n));
    const problems: string[] = [];

    const dups = ints.filter((n, i) => i > 0 && n === ints[i - 1]);
    if (dups.length) problems.push(`duplicate index ${[...new Set(dups)].join(", ")}`);

    if (ints.length >= 2) {
      const missing: number[] = [];
      for (let n = ints[0]!; n <= ints[ints.length - 1]!; n++) {
        if (!ints.includes(n)) missing.push(n);
      }
      if (missing.length) problems.push(`missing index ${missing.join(", ")}`);
    }

    if (problems.length === 0) continue;
    const anchor = members.reduce((lo, b) => (b.id < lo.id ? b : lo), members[0]!);
    issues.push({
      bookId: anchor.id,
      title: anchor.title,
      check: "series_gaps",
      severity: "info",
      message: `Series "${series}": ${problems.join("; ")}.`,
    });
  }
  return issues;
}

/**
 * Run the requested metadata checks over a book set. `checks` defaults to all rules. Issues
 * are returned in book order per check; series_gaps is computed once across the whole set.
 */
export function runQualityChecks(books: Book[], checks: QualityCheck[] = ALL_CHECKS): Issue[] {
  const enabled = new Set(checks);
  const perBook: ((b: Book) => Issue | undefined)[] = [];
  if (enabled.has("missing_metadata")) perBook.push(checkMissingMetadata);
  if (enabled.has("raw_filename_title")) perBook.push(checkRawFilenameTitle);
  if (enabled.has("isbn_invalid")) perBook.push(checkIsbnInvalid);
  if (enabled.has("author_sort_mismatch")) perBook.push(checkAuthorSortMismatch);

  const issues: Issue[] = [];
  for (const b of books) {
    for (const rule of perBook) {
      const issue = rule(b);
      if (issue) issues.push(issue);
    }
  }
  if (enabled.has("series_gaps")) issues.push(...checkSeriesGaps(books));
  return issues;
}
