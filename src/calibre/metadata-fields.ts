// Maps a domain `changes` record onto `calibredb set_metadata --field name:value` argv
// tokens (calibre_update_book). Pure + SDK-free. The value-formatting rules are an
// INDEPENDENT reimplementation derived from `docs/calibredb_help.txt` (the documented
// --field grammar), NOT a line-by-line port of Calibre's GPL source.

import type { Book } from "../domain/book.js";

/** Accepted shapes for one field's new value. */
export type ChangeValue = string | number | string[] | Record<string, string>;

/** Built-in fields settable via set_metadata (custom `#columns` are also allowed). */
export const KNOWN_FIELDS = [
  "title",
  "authors",
  "tags",
  "series",
  "series_index",
  "rating",
  "publisher",
  "pubdate",
  "languages",
  "comments",
  "identifiers",
] as const;

const KNOWN = new Set<string>(KNOWN_FIELDS);

/** A field is writable if it's a known built-in or a custom column (`#`-prefixed). */
export function isAllowedField(key: string): boolean {
  return KNOWN.has(key) || key.startsWith("#");
}

/**
 * Format one field's value into the `value` half of a `--field name:value` token.
 * set_metadata splits each token on its FIRST colon only, so colons inside the value
 * (titles, identifier pairs) are safe; argv-array invocation means no shell escaping.
 */
export function formatFieldValue(field: string, value: ChangeValue): string {
  // identifiers: {isbn:"X", doi:"Y"} → "isbn:X,doi:Y"
  if (field === "identifiers") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("identifiers must be an object of scheme → value");
    }
    return Object.entries(value)
      .map(([scheme, v]) => `${scheme}:${v}`)
      .join(",");
  }
  // authors use ` & ` as the separator; tags/languages are comma-separated lists
  if (field === "authors") {
    return (Array.isArray(value) ? value : [String(value)]).join(" & ");
  }
  if (field === "tags" || field === "languages") {
    return (Array.isArray(value) ? value : [String(value)]).join(",");
  }
  // scalars (title, series, publisher, pubdate, comments, rating, series_index, #custom)
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
  }
  return String(value);
}

/** Build the full `set_metadata <id> --field … --field …` argv for one book. */
export function buildSetMetadataArgs(id: number, changes: Record<string, ChangeValue>): string[] {
  const args: string[] = ["set_metadata", String(id)];
  for (const [field, value] of Object.entries(changes)) {
    args.push("--field", `${field}:${formatFieldValue(field, value)}`);
  }
  return args;
}

/**
 * Read a Book's current value for a calibre field name. Custom `#columns` aren't carried
 * on the Book domain object → undefined (the diff just shows the incoming value as new).
 */
export function bookFieldValue(book: Book, field: string): unknown {
  switch (field) {
    case "title": return book.title;
    case "authors": return book.authors;
    case "tags": return book.tags;
    case "series": return book.series;
    case "series_index": return book.seriesIndex;
    case "rating": return book.rating;
    case "publisher": return book.publisher;
    case "pubdate": return book.pubdate;
    case "languages": return book.languages;
    case "comments": return book.comments;
    case "identifiers": return book.identifiers;
    default: return undefined;
  }
}

/** One field's before/after for a proposed change, with a computed `changed` flag. */
export interface FieldDiff {
  field: string;
  before: unknown;
  after: ChangeValue;
  changed: boolean;
}

/**
 * Compute a WITHOUT-WRITING preview of what `changes` would do to a book — the diff builder
 * behind calibre_bulk_update's `preview` mode. `changed` compares the current value against
 * the proposed one structurally (JSON), so a value already current shows as a no-op.
 */
export function previewBookChanges(
  book: Book,
  changes: Record<string, ChangeValue>,
): FieldDiff[] {
  return Object.entries(changes).map(([field, after]) => {
    const before = bookFieldValue(book, field);
    return { field, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
  });
}
