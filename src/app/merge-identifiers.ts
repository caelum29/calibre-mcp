// Resolves a write's `identifiers` change against the book's current map (#563). `identifiers`
// merges by scheme (case-insensitive) — listed schemes are set, unlisted ones stay, `null` removes one — while
// set_metadata replaces the whole map, so the full merged map is what gets written and verified.

import type { ChangeValue } from "../domain/book-fields.js";
import type { Book } from "../domain/book.js";

/**
 * Return `changes` with `identifiers` (when it is a scheme map) replaced by the book's current
 * identifiers merged with it. Every other field passes through untouched (they replace).
 * Non-map `identifiers` values pass through too, so the field validator still rejects them.
 */
export function mergeIdentifierChanges(
  book: Pick<Book, "identifiers">,
  changes: Record<string, ChangeValue>,
): Record<string, ChangeValue> {
  const listed = changes.identifiers;
  if (typeof listed !== "object" || listed === null || Array.isArray(listed)) return changes;
  // Calibre stores identifier types lowercased, so `ISBN` and `isbn` are one scheme: fold both
  // sides, or two keys reach calibredb and Calibre picks the winner
  const merged: Record<string, string> = {};
  for (const [scheme, value] of Object.entries(book.identifiers ?? {})) {
    if (value !== undefined) merged[scheme.toLowerCase()] = value;
  }
  for (const [scheme, value] of Object.entries(listed)) {
    if (value === null) delete merged[scheme.toLowerCase()];
    else merged[scheme.toLowerCase()] = value;
  }
  return { ...changes, identifiers: merged };
}
