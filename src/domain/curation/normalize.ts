// Normalization helpers for curation (duplicate detection + quality checks). Pure,
// SDK-free, clean-room. Keys collapse cosmetic differences so the same work groups
// together; authorToAuthorSort is an independent heuristic reimplementation (NOT ported
// from Calibre's GPL author_to_author_sort).

import type { Book } from "../book.js";

/** Collapse runs of whitespace and trim. */
function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Lowercase + collapse whitespace — the light-touch normalization. */
function light(s: string): string {
  return collapseWs(s.toLowerCase());
}

/**
 * Exact-ish grouping key: light-normalized title + sorted light-normalized authors.
 * Groups books that are the "same" modulo case/whitespace differences.
 */
export function identicalKey(book: Book): string {
  const title = light(book.title);
  const authors = book.authors.map(light).filter(Boolean).sort().join(",");
  return `${title}|${authors}`;
}

/** Trailing author-name suffixes kept after the surname in author-sort form. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md"]);

/** Strip diacritics via NFKD + drop combining marks. */
function stripAccents(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "");
}

/**
 * Aggressive fuzzy grouping key: accent-stripped, subtitle-dropped, article-stripped,
 * alphanumeric-only title + a normalized author token set. Deliberately lossy — catches
 * "The Rust Programming Language" vs "Rust Programming Language: 2nd Ed".
 */
export function similarKey(book: Book): string {
  let t = stripAccents(book.title.toLowerCase());
  // Drop subtitle after a colon or an opening paren.
  const cut = t.search(/[:(]/);
  if (cut > 0) t = t.slice(0, cut);
  t = t.replace(/[^a-z0-9\s]/g, " ");
  t = collapseWs(t).replace(/^(the|a|an)\s+/, "");
  t = t.replace(/\s+/g, "");

  const authors = book.authors
    .map((a) => collapseWs(stripAccents(a.toLowerCase()).replace(/[^a-z0-9\s]/g, " ")))
    .filter(Boolean)
    .sort()
    .join(",");
  return `${t}|${authors}`;
}

/**
 * Heuristic "Firstname Lastname" → "Lastname, Firstname" (author-sort form). Independent
 * reimplementation from the documented convention — NOT a port of Calibre's GPL routine,
 * so it intentionally handles only the common cases:
 *  - already contains a comma  → returned unchanged
 *  - single token             → returned unchanged
 *  - trailing suffix (Jr/III) → kept after the surname ("Ralph Johnson Jr" → "Johnson, Ralph Jr")
 */
export function authorToAuthorSort(name: string): string {
  const trimmed = collapseWs(name);
  if (!trimmed || trimmed.includes(",")) return trimmed;

  const parts = trimmed.split(" ");
  if (parts.length < 2) return trimmed;

  let suffix = "";
  const last = parts[parts.length - 1]!;
  if (SUFFIXES.has(last.replace(/\./g, "").toLowerCase()) && parts.length > 2) {
    suffix = ` ${last}`;
    parts.pop();
  }

  const surname = parts.pop()!;
  const given = parts.join(" ");
  return `${surname}, ${given}${suffix}`;
}
