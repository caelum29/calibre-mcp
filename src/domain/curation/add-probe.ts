// Match decision for calibre_add_book's post-add duplicate probe (#204, #341). Uses the same
// matcher as find_duplicates mode:similar, so add_book and find_duplicates/merge_books agree
// on what counts as a duplicate. Pure + SDK-free; the library searches live in tools/.

import type { Book } from "../book.js";
import { normalizeIsbn } from "./isbn.js";
import { isSimilarMatch } from "./normalize.js";

/** A just-added book that looks like it duplicates other books. */
export interface PossibleDuplicate {
  id: number;
  of: number[];
  reason: "isbn" | "title";
}

/** Probe at most this many added ids: a bulk folder add must not fan out into hundreds of reads. */
export const MAX_PROBED = 10;

/** The book's ISBN with separators removed, or "" when it has none. */
export function isbnKey(b: Book): string {
  return normalizeIsbn(b.identifiers.isbn ?? "");
}

// A raw import has no authors yet, so its authors are unknown rather than different:
// compare titles alone (still edition-aware) when either side lacks authors.
function sameWork(a: Book, b: Book): boolean {
  if (a.authors.length > 0 && b.authors.length > 0) return isSimilarMatch(a, b);
  return isSimilarMatch({ ...a, authors: [] }, { ...b, authors: [] });
}

/**
 * Decide which candidates duplicate the just-added book: the same ISBN, or the same work per
 * the find_duplicates `similar` matcher. Only the book itself is excluded, so a copy added in
 * the same call is a candidate too (#341). Undefined when nothing matches.
 */
export function matchAddedBook(added: Book, candidates: Book[]): PossibleDuplicate | undefined {
  const others = candidates.filter((c) => c.id !== added.id);
  const isbn = isbnKey(added);
  const byIsbn = isbn ? others.filter((c) => isbnKey(c) === isbn).map((c) => c.id) : [];
  const byTitle = others.filter((c) => sameWork(added, c)).map((c) => c.id);
  const of = [...new Set([...byIsbn, ...byTitle])].sort((a, b) => a - b);
  if (of.length === 0) return undefined;
  return { id: added.id, of, reason: byIsbn.length > 0 ? "isbn" : "title" };
}
