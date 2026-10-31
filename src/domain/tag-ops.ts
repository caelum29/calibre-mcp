// Tag add/remove merge for calibre_bulk_update (#321): new = (existing ∪ add) \ remove, compared
// case-insensitively like Calibre's tag items, so a merge never duplicates or misses a tag
// that differs only in case. Pure + SDK-free.

import { sameItemName } from "./book-fields.js";

/** One book's merged tag list plus how many tags it gained and lost. */
export interface TagMerge {
  tags: string[];
  added: number;
  removed: number;
}

/**
 * Merge `add` into and drop `remove` from a book's `existing` tags. Existing spellings and
 * order are kept, new tags are appended; a tag in both `add` and `remove` ends up removed.
 */
export function mergeTags(existing: readonly string[], add: readonly string[], remove: readonly string[]): TagMerge {
  const has = (list: readonly string[], t: string): boolean => list.some((x) => sameItemName(x, t));
  const tags = existing.filter((t) => !has(remove, t));
  const removed = existing.length - tags.length;
  let added = 0;
  for (const t of add) {
    if (has(remove, t) || has(tags, t)) continue;
    tags.push(t);
    added++;
  }
  return { tags, added, removed };
}
