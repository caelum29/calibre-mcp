// Normalization helpers for curation (duplicate detection + quality checks). Pure,
// SDK-free, clean-room. Keys collapse cosmetic differences so the same work groups
// together; authorToAuthorSort is an independent heuristic reimplementation (NOT ported
// from Calibre's GPL author_to_author_sort).

import type { Book } from "../book.js";
import { pubYear, splitEdition, splitTrailingYear } from "./edition.js";

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

/**
 * Fold accents for fuzzy matching. Only Latin/Greek diacritics are dropped (café → cafe);
 * marks in other scripts are letters in their own right (Cyrillic й/ї, Japanese が, Indic
 * vowel signs), so they are recomposed via NFC instead. ё → е because Russian print treats
 * them as interchangeable.
 */
export function foldAccents(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/([\p{Script=Latin}\p{Script=Greek}])\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/ё/g, "е");
}

/** Replace everything except letters, digits and (non-Latin) combining marks with a space. */
function keepWordChars(s: string): string {
  return s.replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ");
}

/** Lowercase → word chars only → collapse → drop a leading English article → no spaces. */
function squash(s: string): string {
  return collapseWs(keepWordChars(s))
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, "");
}

/**
 * Fuzzy grouping key plus the edition signals that may still tell two same-key books
 * apart (#242). Every signal is optional: absent means "unknown", not "different".
 */
export interface SimilarParts {
  /** Main title (no subtitle/edition/year) + sorted normalized authors. */
  key: string;
  /** Normalized text after the first colon, e.g. the volume name of a series. */
  subtitle?: string;
  /** Edition number parsed from the title ("3rd Edition", "2-е издание"). */
  edition?: number;
  /** Trailing year in the title ("Excel 2019"). */
  titleYear?: number;
  /** Year of the Calibre pubdate. */
  pubYear?: number;
}

/**
 * Split a book into its fuzzy key and edition signals. Accent-folded, letters/digits of
 * any script (#241); parentheticals dropped; edition phrases and a trailing year moved to
 * side fields so "NodeJS Design Patterns 3rd Edition 2020" keys like "Node.js Design Patterns".
 *
 * Returns `undefined` when the title has no letters or digits left: such a book can't be
 * fuzzily compared, and keying it on authors alone groups unrelated books (#241).
 */
export function similarParts(book: Book): SimilarParts | undefined {
  const folded = foldAccents(book.title.toLowerCase());
  const { rest: noEdition, edition } = splitEdition(folded);
  // Parenthetical/bracketed asides ("(Special Edition)", "[print PDF]") never discriminate.
  const paren = noEdition.search(/[([]/);
  const noParen = paren > 0 ? noEdition.slice(0, paren) : noEdition;
  const { rest: noYear, year: titleYear } = splitTrailingYear(noParen);

  const colon = noYear.indexOf(":");
  const main = squash(colon > 0 ? noYear.slice(0, colon) : noYear);
  if (!main) return undefined;
  const subtitle = colon > 0 ? squash(noYear.slice(colon + 1)) : "";

  const authors = book.authors
    .map((a) => collapseWs(keepWordChars(foldAccents(a.toLowerCase()))))
    .filter(Boolean)
    .sort()
    .join(",");
  return {
    key: `${main}|${authors}`,
    subtitle: subtitle || undefined,
    edition,
    titleYear,
    pubYear: pubYear(book.pubdate),
  };
}

/**
 * Aggressive fuzzy grouping key: the {@link similarParts} key (main title + authors).
 * Deliberately lossy — "The Rust Programming Language" and "Rust Programming Language:
 * 2nd Edition" share it. Use {@link isSimilarMatch} to also respect edition signals.
 */
export function similarKey(book: Book): string | undefined {
  return similarParts(book)?.key;
}

/**
 * Pubdates this many years apart (or more) read as different editions (#242). Basis: heuristic from
 * #242, not measured on the library; revisit if the duplicate report splits true duplicates.
 */
const EDITION_YEAR_GAP = 2;

/** True when two same-key parts carry no conflicting edition signal. */
export function editionsCompatible(a: SimilarParts, b: SimilarParts): boolean {
  const differ = <T>(x: T | undefined, y: T | undefined) => x !== undefined && y !== undefined && x !== y;
  if (differ(a.subtitle, b.subtitle) || differ(a.edition, b.edition) || differ(a.titleYear, b.titleYear)) {
    return false;
  }
  return a.pubYear === undefined || b.pubYear === undefined || Math.abs(a.pubYear - b.pubYear) < EDITION_YEAR_GAP;
}

/** Same work AND no conflicting edition signal — the `similar`-mode notion of a duplicate. */
export function isSimilarMatch(a: Book, b: Book): boolean {
  const pa = similarParts(a);
  const pb = similarParts(b);
  return pa !== undefined && pb !== undefined && pa.key === pb.key && editionsCompatible(pa, pb);
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
