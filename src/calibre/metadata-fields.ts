// Maps a domain `changes` record onto `calibredb set_metadata --field name:value` argv
// tokens (calibre_update_book). Pure + SDK-free. The value-formatting rules are an
// INDEPENDENT reimplementation derived from `docs/dev/calibredb_help.txt` (the documented
// --field grammar), NOT a line-by-line port of Calibre's GPL source.

import type { ChangeValue } from "../domain/book-fields.js";
import { InvalidFieldValueError } from "../domain/errors.js";

/**
 * Format one field's value into the `value` half of a `--field name:value` token.
 * set_metadata splits each token on its FIRST colon only, so colons inside the value
 * (titles, identifier pairs) are safe; argv-array invocation means no shell escaping.
 */
export function formatFieldValue(field: string, value: ChangeValue): string {
  // identifiers: {isbn:"X", doi:"Y"} → "isbn:X,doi:Y"
  if (field === "identifiers") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new InvalidFieldValueError(
        'identifiers must be an object of scheme → value, e.g. {"isbn": "9780132350884"}',
      );
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
  // Calibre fills the missing parts of a partial date from today (2020 → 2020-<this month>-15),
  // so the stored date would depend on when the write ran (#423): pin them to the first day.
  if (field === "pubdate" && typeof value === "string") {
    const v = value.trim();
    if (/^\d{4}$/.test(v)) return `${v}-01-01`;
    const ym = /^(\d{4})-(\d{1,2})$/.exec(v);
    // only real months; "2020-13" stays as typed and is Calibre's call
    if (ym && Number(ym[2]) >= 1 && Number(ym[2]) <= 12) return `${ym[1]}-${ym[2]!.padStart(2, "0")}-01`;
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
