// Maps a domain `changes` record onto `calibredb set_metadata --field name:value` argv
// tokens (calibre_update_book). Pure + SDK-free. The value-formatting rules are an
// INDEPENDENT reimplementation derived from `docs/dev/calibredb_help.txt` (the documented
// --field grammar), NOT a line-by-line port of Calibre's GPL source.

import type { ChangeValue } from "../domain/book-fields.js";

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
