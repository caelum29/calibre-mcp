// Merge semantics for calibre_merge_books (spec #50). Pure, SDK-free. An INDEPENDENT
// clean-room reimplementation of Calibre's documented/observed merge contract (issue #35)
// — NOT a translation of Calibre's GPL merge code.

import type { Book } from "./book.js";

/** One field's merged value, structurally compatible with metadata-fields' ChangeValue. */
export type MergedValue = string | number | string[] | Record<string, string>;

/** A custom column's value on one book, as read from `/ajax/book` user_metadata. */
export interface CustomFieldValue {
  /** Column label including the leading `#` (e.g. `#read`). */
  label: string;
  datatype: string;
  isMultiple: boolean;
  value: unknown;
  /** Series index for series-type columns. */
  extra?: number;
}

/** Disposition of one source format: moved to the target, or dropped (target's copy wins). */
export interface FormatMove {
  /** Lowercase format (e.g. "epub"). */
  format: string;
  sourceId: number;
  action: "moves" | "dropped";
}

/**
 * Plan per-source format dispositions. The target's copy of a format always wins; among
 * sources, first-come wins (matches processing order — later duplicates are dropped).
 */
export function planFormatMoves(target: Book, sources: Book[]): FormatMove[] {
  const claimed = new Set(target.formats.map((f) => f.toLowerCase()));
  const moves: FormatMove[] = [];
  for (const src of sources) {
    for (const fmt of src.formats.map((f) => f.toLowerCase())) {
      if (claimed.has(fmt)) {
        moves.push({ format: fmt, sourceId: src.id, action: "dropped" });
      } else {
        claimed.add(fmt);
        moves.push({ format: fmt, sourceId: src.id, action: "moves" });
      }
    }
  }
  return moves;
}

/** Calibre's undefined-date sentinel (0101-01-01…) counts as "no pubdate". */
function isEmptyDate(d?: string): boolean {
  return !d || d.startsWith("0101-01-01");
}

/** "Unknown" is Calibre's placeholder author — counts as empty for fill-if-empty. */
function authorsEmpty(authors: string[]): boolean {
  return (
    authors.length === 0 || (authors.length === 1 && authors[0]!.trim().toLowerCase() === "unknown")
  );
}

/** First source (in order) whose field passes `has`; undefined when none does. */
function firstSource<T>(sources: Book[], pick: (b: Book) => T | undefined): T | undefined {
  for (const s of sources) {
    const v = pick(s);
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Merge built-in metadata from `sources` into `target` per Calibre's rules:
 * fill-if-empty (title, authors, publisher, rating, series+index, pubdate), union (tags),
 * `\n\n`-concat (comments, skipping ones identical to the target's original), identifiers
 * union with target-precedence. Returns ONLY the fields whose value actually changes.
 */
export function mergeBuiltinMetadata(target: Book, sources: Book[]): Record<string, MergedValue> {
  const changes: Record<string, MergedValue> = {};

  if (target.title.trim() === "") {
    const t = firstSource(sources, (s) => (s.title.trim() === "" ? undefined : s.title));
    if (t !== undefined) changes.title = t;
  }
  if (authorsEmpty(target.authors)) {
    const a = firstSource(sources, (s) => (authorsEmpty(s.authors) ? undefined : s.authors));
    if (a !== undefined) changes.authors = a;
  }
  if (!target.publisher) {
    const p = firstSource(sources, (s) => s.publisher || undefined);
    if (p !== undefined) changes.publisher = p;
  }
  if (!target.rating) {
    const r = firstSource(sources, (s) => s.rating || undefined);
    if (r !== undefined) changes.rating = r;
  }
  if (isEmptyDate(target.pubdate)) {
    const d = firstSource(sources, (s) => (isEmptyDate(s.pubdate) ? undefined : s.pubdate));
    if (d !== undefined) changes.pubdate = d;
  }
  if (!target.series) {
    const src = sources.find((s) => s.series);
    if (src?.series) {
      changes.series = src.series;
      if (src.seriesIndex !== undefined) changes.series_index = src.seriesIndex;
    }
  }

  // tags: union, target's order first, then new tags in source order
  const tagSeen = new Set(target.tags.map((t) => t.toLowerCase()));
  const mergedTags = [...target.tags];
  for (const src of sources) {
    for (const tag of src.tags) {
      if (!tagSeen.has(tag.toLowerCase())) {
        tagSeen.add(tag.toLowerCase());
        mergedTags.push(tag);
      }
    }
  }
  if (mergedTags.length !== target.tags.length) changes.tags = mergedTags;

  // comments: concat with \n\n, skipping empties and ones identical to the target's original
  const parts = target.comments ? [target.comments] : [];
  for (const src of sources) {
    if (src.comments && src.comments !== target.comments && !parts.includes(src.comments)) {
      parts.push(src.comments);
    }
  }
  const mergedComments = parts.join("\n\n");
  if (parts.length > 0 && mergedComments !== (target.comments ?? "")) {
    changes.comments = mergedComments;
  }

  // identifiers: union; later sources overwrite earlier, the target overlays last (precedence)
  const mergedIds: Record<string, string> = {};
  for (const src of sources) {
    for (const [scheme, v] of Object.entries(src.identifiers)) {
      if (v !== undefined) mergedIds[scheme] = v;
    }
  }
  for (const [scheme, v] of Object.entries(target.identifiers)) {
    if (v !== undefined) mergedIds[scheme] = v;
  }
  if (
    Object.keys(mergedIds).length > 0 &&
    JSON.stringify(mergedIds) !== JSON.stringify(target.identifiers)
  ) {
    changes.identifiers = mergedIds;
  }

  return changes;
}

/** Empty test for a custom-column value (calibre stores "unset" as null). */
function customEmpty(f: CustomFieldValue): boolean {
  const v = f.value;
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    return v.trim() === "" || (f.datatype === "datetime" && v.startsWith("0101-01-01"));
  }
  if (Array.isArray(v)) return v.length === 0;
  return false; // numbers and booleans (incl. false) are real values
}

/** Encode one custom value into `--field '#label:value'` form (probe-verified encodings). */
function encodeCustom(f: CustomFieldValue, value: unknown, extra?: number): MergedValue {
  if (f.datatype === "bool") return value ? "true" : "false";
  if (f.datatype === "series") {
    const name = String(value);
    return extra !== undefined ? `${name} [${extra}]` : name;
  }
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "number") return value;
  return String(value);
}

/**
 * Merge custom columns per datatype (issue #35): union for multi-value, `\n\n`-concat for
 * comments-type, fill-if-empty for everything else; composite columns are computed →
 * skipped. `sources` is each source book's field list, in merge order. Returns only
 * changed labels, values pre-encoded for set_metadata `--field`.
 */
export function mergeCustomMetadata(
  targetFields: CustomFieldValue[],
  sources: CustomFieldValue[][],
): Record<string, MergedValue> {
  const changes: Record<string, MergedValue> = {};
  const bySource = sources.map((list) => new Map(list.map((f) => [f.label, f] as const)));

  for (const tf of targetFields) {
    if (tf.datatype === "composite") continue;
    const srcFields = bySource
      .map((m) => m.get(tf.label))
      .filter((f): f is CustomFieldValue => f !== undefined);

    if (tf.datatype === "comments") {
      const tv = typeof tf.value === "string" ? tf.value : "";
      const parts = tv ? [tv] : [];
      for (const sf of srcFields) {
        const sv = typeof sf.value === "string" ? sf.value : "";
        if (sv && sv !== tv && !parts.includes(sv)) parts.push(sv);
      }
      const merged = parts.join("\n\n");
      if (parts.length > 0 && merged !== tv) changes[tf.label] = merged;
      continue;
    }

    if (tf.isMultiple) {
      const current = Array.isArray(tf.value) ? tf.value.map(String) : [];
      const seen = new Set(current.map((v) => v.toLowerCase()));
      const merged = [...current];
      for (const sf of srcFields) {
        for (const v of Array.isArray(sf.value) ? sf.value.map(String) : []) {
          if (!seen.has(v.toLowerCase())) {
            seen.add(v.toLowerCase());
            merged.push(v);
          }
        }
      }
      if (merged.length !== current.length) changes[tf.label] = merged;
      continue;
    }

    // fill-if-empty (bool/int/float/rating/datetime/enumeration/single-text/series+index)
    if (customEmpty(tf)) {
      const filler = srcFields.find((sf) => !customEmpty(sf));
      if (filler) changes[tf.label] = encodeCustom(tf, filler.value, filler.extra);
    }
  }
  return changes;
}
