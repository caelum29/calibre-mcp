// Book-field rules: which fields are writable, how a Book's value is read per field, and
// before/after comparison + preview diffs. Pure + SDK-free; calibredb argv lives in calibre/.

import type { Book } from "./book.js";

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
 * Read a Book's current value for a calibre field name. Custom `#columns` aren't carried
 * on the Book domain object → undefined (the diff just shows the incoming value as new).
 */
export function bookFieldValue(book: Book, field: string): unknown {
  switch (field) {
    case "title":
      return book.title;
    case "authors":
      return book.authors;
    case "tags":
      return book.tags;
    case "series":
      return book.series;
    case "series_index":
      return book.seriesIndex;
    case "rating":
      return book.rating;
    case "publisher":
      return book.publisher;
    case "pubdate":
      return book.pubdate;
    case "languages":
      return book.languages;
    case "comments":
      return book.comments;
    case "identifiers":
      return book.identifiers;
    default:
      return undefined;
  }
}

/**
 * After an AMBIGUOUS write (calibredb timed out — the routed server may have committed),
 * decide from a re-read whether every requested change landed. A field counts as applied
 * when the re-read equals the intended value OR moved away from the before-snapshot (covers
 * fields Calibre normalizes on write, e.g. pubdate). Values compare via {@link sameFieldValue},
 * so a landed clear read back as absent and a reordered identifiers map both count as applied.
 * Custom #columns aren't carried on Book → unverifiable → false, so callers stay cautious
 * rather than claim success (issue #33).
 */
export function changesSatisfied(before: Book, after: Book, changes: Record<string, ChangeValue>): boolean {
  return Object.entries(changes).every(([field, intended]) => {
    if (field.startsWith("#")) return false;
    const a = bookFieldValue(after, field);
    return sameFieldValue(a, intended) || !sameFieldValue(a, bookFieldValue(before, field));
  });
}

// Calibre reads a cleared field back as absent, "", [] or {} depending on the field, so
// clearing an already-empty field must not show up as a change (#202).
function isEmptyValue(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  return typeof v === "object" && Object.keys(v).length === 0;
}

/**
 * Value equality for one field's before/after (#202). Arrays compare element-wise in order
 * (author order is meaningful); plain objects (identifiers) ignore key order, since the
 * server may return the same map in a different order; every "empty" shape equals every other.
 */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b || (isEmptyValue(a) && isEmptyValue(b))) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameFieldValue(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const ka = Object.keys(a);
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.length === Object.keys(b).length && ka.every((k) => k in rb && sameFieldValue(ra[k], rb[k]));
  }
  return false;
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
export function previewBookChanges(book: Book, changes: Record<string, ChangeValue>): FieldDiff[] {
  return Object.entries(changes).map(([field, after]) => {
    const before = bookFieldValue(book, field);
    return { field, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
  });
}
