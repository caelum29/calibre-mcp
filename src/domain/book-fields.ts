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
 * After an AMBIGUOUS write (calibredb timed out or the connection dropped — the routed server
 * may have committed), decide from a re-read whether every requested change landed. A field
 * counts only when the re-read shows the INTENDED value ({@link matchesIntended}); "moved away
 * from before" is not enough — a concurrent GUI edit or a stale selection snapshot moves it too
 * (#370). Custom #columns aren't carried on Book → unverifiable → false (issue #33).
 */
export function changesSatisfied(_before: Book, after: Book, changes: Record<string, ChangeValue>): boolean {
  return Object.entries(changes).every(
    ([field, intended]) => !field.startsWith("#") && matchesIntended(field, bookFieldValue(after, field), intended),
  );
}

/** A re-read value that is neither the before-snapshot nor the requested one. */
export interface ForeignValue {
  field: string;
  after: unknown;
  intended: ChangeValue;
}

/**
 * Fields whose re-read shows a third value — neither `before` nor ours: someone else's edit (or a
 * Calibre normalization we don't model), so the write is unverified rather than not-landed (#370).
 */
export function foreignValues(before: Book, after: Book, changes: Record<string, ChangeValue>): ForeignValue[] {
  return Object.entries(changes)
    .filter(([field]) => !field.startsWith("#"))
    .map(([field, intended]) => ({ field, after: bookFieldValue(after, field), intended }))
    .filter(
      (v) =>
        !matchesIntended(v.field, v.after, v.intended) && !sameFieldValue(v.after, bookFieldValue(before, v.field)),
    );
}

/**
 * Whether a re-read value is the value we asked for, allowing only for how Calibre stores it:
 * list strings split like calibredb does, tags/languages as case-insensitive sets (Calibre sorts
 * them and keeps the library's spelling), authors in order, a pubdate on the same day (it adds a
 * time and may shift by the timezone), and numeric strings for series_index/rating.
 */
export function matchesIntended(field: string, after: unknown, intended: ChangeValue): boolean {
  const want = tidy(field, intended);
  const got = tidy(field, after);
  if (sameFieldValue(got, want)) return true;
  if (field === "tags" || field === "languages") return sameNameSet(got, want);
  if (field === "authors") return sameNameList(got, want);
  if (field === "pubdate") return sameDay(got, want);
  if (field === "series_index" || field === "rating") return sameNumber(got, want);
  return false;
}

// Calibre strips surrounding whitespace and splits an "A & B" author entry, so compare
// both sides that way: a landed write must not read as unverified over a space (#380 review).
function tidy(field: string, v: unknown): unknown {
  if (typeof v === "string") return splitListString(field, v.trim());
  if (!Array.isArray(v)) return v;
  return v.flatMap((x: unknown) => {
    if (typeof x !== "string") return [x];
    const parts = field === "authors" ? x.split(" & ") : [x];
    return parts.map((t) => t.trim()).filter(Boolean);
  });
}

function sameNameList(a: unknown, b: unknown): boolean {
  return (
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameEntry(x, b[i] as unknown))
  );
}

function sameNameSet(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const has = (list: unknown[], x: unknown) => list.some((y) => sameEntry(x, y));
  return a.every((x) => has(b, x)) && b.every((x) => has(a, x));
}

const DAY_MS = 86_400_000;

// ±1 day: Calibre stores a date-only pubdate as a local midnight, read back in UTC
function sameDay(a: unknown, b: unknown): boolean {
  const day = (v: unknown) => (typeof v === "string" ? Date.parse(v.slice(0, 10)) : Number.NaN);
  const da = day(a);
  const db = day(b);
  return Number.isFinite(da) && Number.isFinite(db) && Math.abs(da - db) <= DAY_MS;
}

function sameNumber(a: unknown, b: unknown): boolean {
  const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN);
  return Number.isFinite(num(a)) && num(a) === num(b);
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
 * behind calibre_bulk_update's `preview` mode. `changed` uses {@link sameFieldValue}, the same
 * equality as the applied diff, so a value already current (incl. "" vs absent) is a no-op (#342).
 */
export function previewBookChanges(book: Book, changes: Record<string, ChangeValue>): FieldDiff[] {
  return Object.entries(changes).map(([field, after]) => {
    const before = bookFieldValue(book, field);
    return { field, before, after, changed: !sameFieldValue(before, after) };
  });
}

/** Entry count of a list-like field value (array items or identifier keys); undefined for scalars. */
function listSize(v: unknown): number | undefined {
  // Calibre stores `Python, python` as one item, so count case-duplicates once.
  if (Array.isArray(v)) return v.filter((x, i) => !v.slice(0, i).some((y) => sameEntry(x, y))).length;
  if (v && typeof v === "object") return Object.keys(v).length;
  return undefined;
}

/**
 * A string given for a list field is split by calibredb on its separator (authors ` & `,
 * tags/languages `,`), so the preview must count it as a list too.
 */
function splitListString(field: string, v: ChangeValue): ChangeValue {
  if (typeof v !== "string") return v;
  const sep = field === "authors" ? " & " : field === "tags" || field === "languages" ? "," : undefined;
  return sep
    ? v
        .split(sep)
        .map((x) => x.trim())
        .filter(Boolean)
    : v;
}

/** Most dropped entries a replacement note names before summarising the rest. */
const MAX_NAMED_DROPS = 5;

/**
 * Preview flag for a list-field "set" that would drop existing entries. Sets replace the whole
 * list, so a short value silently loses the rest: `tags: 3 → 2 (replaces the list: drops y, z)`,
 * or `(replaces all existing tags)` when nothing is kept (#342). Kept = the same item name
 * (case-insensitive — a case change is a rename, see {@link caseRenameNotes}); an identifier is
 * kept only with the same value. Undefined when nothing existing would be lost.
 */
export function listReplacementNote(d: FieldDiff): string | undefined {
  const was = listSize(d.before);
  const after = splitListString(d.field, d.after);
  const now = listSize(after);
  if (!was || now === undefined) return undefined;
  const all = `${d.field}: ${was} → ${now} (replaces all existing ${d.field})`;
  const dropped: string[] = [];
  let keptAny = false;
  if (Array.isArray(d.before)) {
    const list = Array.isArray(after) ? after : [];
    for (const e of d.before) {
      if (list.some((x) => sameEntry(x, e))) keptAny = true;
      else if (!dropped.some((x) => sameEntry(x, e))) dropped.push(String(e));
    }
  } else if (after && typeof after === "object" && !Array.isArray(after)) {
    // An identifier is kept only with the same value: isbn 1 → 2 replaces the old one.
    const next = Object.entries(after);
    for (const [type, val] of Object.entries(d.before as Record<string, unknown>)) {
      if (next.some(([t, v]) => sameItemName(t, type) && String(v) === String(val))) keptAny = true;
      else dropped.push(`${type}:${String(val)}`);
    }
  } else {
    return all; // a non-map value for identifiers keeps nothing
  }
  if (dropped.length === 0) return undefined;
  if (!keptAny) return all;
  const named = dropped.slice(0, MAX_NAMED_DROPS).join(", ");
  const more = dropped.length > MAX_NAMED_DROPS ? ` and ${dropped.length - MAX_NAMED_DROPS} more` : "";
  return `${d.field}: ${was} → ${now} (replaces the list: drops ${named}${more})`;
}

/**
 * Whether two names are the same Calibre item (tag, author, language, identifier type).
 * Calibre keeps one case-insensitive item per name (its Python layer lowercases, Cyrillic
 * included), so setting `python` on a book with `Python` RENAMES that item library-wide.
 * Strings only, exact otherwise: no trim or NFC here (Calibre strips tags itself), and
 * identifier VALUES are not names — compare those exactly.
 */
export function sameItemName(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

// One list entry vs another: names case-insensitively, anything else structurally.
function sameEntry(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" ? sameItemName(a, b) : sameFieldValue(a, b);
}

// Fields whose items are shared across books, so a case change renames them everywhere.
const SHARED_NAME_FIELDS = new Set(["tags", "authors"]);

/**
 * Preview notes for case-only edits of shared items, e.g.
 * `tags: Python → python renames it on every book in the library (…)`: Calibre keeps one
 * case-insensitive item, so the new case applies to every book that has it.
 */
export function caseRenameNotes(d: FieldDiff): string[] {
  if (!SHARED_NAME_FIELDS.has(d.field) || !Array.isArray(d.before)) return [];
  const after = splitListString(d.field, d.after);
  if (!Array.isArray(after)) return [];
  const notes: string[] = [];
  for (const old of d.before) {
    if (typeof old !== "string") continue;
    const next = after.find((x): x is string => typeof x === "string" && sameItemName(x, old));
    if (next !== undefined && next !== old) {
      notes.push(
        `${d.field}: ${old} → ${next} renames it on every book in the library (Calibre keeps one case-insensitive item)`,
      );
    }
  }
  return notes;
}
