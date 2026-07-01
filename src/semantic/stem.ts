// Node-side pre-stemming for the FTS keyword half of hybrid search. FTS5's unicode61
// tokenizer does ZERO stemming (Russian книга/книги/книгу never match each other) and its
// built-in `porter` stemmer is English-only — so we stem in JS before INSERT and apply the
// IDENTICAL transform to queries (SEMANTIC-SEARCH.md §4). Per-token script detection routes
// Cyrillic → Snowball russian, Latin → english; code/identifiers (digits, underscores,
// camelCase) pass through raw so exact identifier search still works. The FTS table also keeps
// a raw `body` column, so even a mis-stemmed token stays exact-searchable there.

import snowball from "snowball-stemmers";

const ru = snowball.newStemmer("russian");
const en = snowball.newStemmer("english");

// Word tokens = runs of letters/digits/underscore (matches FTS5 tokenchars). The `u` flag with
// \p{L}\p{N} keeps Cyrillic and Latin together; everything else is a separator and dropped.
const TOKEN = /[\p{L}\p{N}_]+/gu;
const HAS_CYRILLIC = /\p{Script=Cyrillic}/u;
const HAS_LATIN = /\p{Script=Latin}/u;

/** Tokens we must NOT stem: they carry digits, underscores, or a camelCase hump → identifiers. */
function isCode(tok: string): boolean {
  if (/[\d_]/.test(tok)) return true;
  return /\p{Ll}\p{Lu}/u.test(tok); // lowercase→uppercase transition = camelCase
}

/** Stem one token by its dominant script; normalize ё→е for Russian. */
export function stemToken(tok: string): string {
  const lower = tok.toLowerCase();
  if (isCode(tok)) return lower;
  if (HAS_CYRILLIC.test(tok)) return ru.stem(lower.replace(/ё/g, "е"));
  if (HAS_LATIN.test(tok)) return en.stem(lower);
  return lower; // digits-only or other scripts → unchanged
}

/**
 * Transform text into a space-joined stream of stemmed tokens. Used for BOTH the stored
 * `body_stem` column and the query, so ingest and search stem identically.
 */
export function stemText(text: string): string {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) out.push(stemToken(m[0]));
  return out.join(" ");
}
