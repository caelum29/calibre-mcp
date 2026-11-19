// Node-side pre-stemming for the FTS keyword half of hybrid search. FTS5's unicode61
// tokenizer does ZERO stemming (Russian книга/книги/книгу never match each other) and its
// built-in `porter` stemmer is English-only — so we stem in JS before INSERT and apply the
// IDENTICAL transform to queries (SEMANTIC-SEARCH.md §4). A thin wrapper over the language-pack
// registry (src/semantic/language/, ADR-0032): each token goes to its pack's stemmer; tokens with
// digits, underscores or camelCase pass through unstemmed. stemText() splits tokens at `+ # . -`
// (`c++` → `c`, `node.js` → `node js`); exact identifier matching against the raw `body` column
// happens in the store's MATCH builder (store/shared.ts ftsMatch, #634), which adds such tokens
// in their raw form.

import type { LanguagePack } from "./language/pack.js";
import { packForToken, PACKS, queryPacks } from "./language/registry.js";

// Word tokens = runs of letters/digits/underscore (matches FTS5 tokenchars). The `u` flag with
// \p{L}\p{N} keeps Cyrillic and Latin together; everything else is a separator and dropped.
const TOKEN = /[\p{L}\p{N}_]+/gu;

/** Tokens we must NOT stem: they carry digits, underscores, or a camelCase hump → identifiers. */
function isCode(tok: string): boolean {
  if (/[\d_]/.test(tok)) return true;
  return /\p{Ll}\p{Lu}/u.test(tok); // lowercase→uppercase transition = camelCase
}

/**
 * Stem one token with its language pack on the index side: the book language's pack for its
 * script unless the token holds another pack's distinctive letters (ADR-0032 item 3). With no
 * `lang` the script's default pack stems it (Cyrillic → ru, which folds ё→е; Latin → en).
 */
export function stemToken(tok: string, lang?: string, packs: readonly LanguagePack[] = PACKS): string {
  const lower = tok.toLowerCase();
  if (isCode(tok)) return lower;
  return packForToken(tok, lang, packs)?.stem(lower) ?? lower; // digits-only or other scripts → unchanged
}

/**
 * Transform text into a space-joined stream of stemmed tokens in the book's language `lang`.
 * Used for the stored `body_stem` column; a query without library languages stems the same way.
 */
export function stemText(text: string, lang?: string, packs: readonly LanguagePack[] = PACKS): string {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) out.push(stemToken(m[0], lang, packs));
  return out.join(" ");
}

/** Word tokens of `text` with their stems and char positions — same tokenizer as stemText. */
export function* stemmedTokens(
  text: string,
  lang?: string,
  packs: readonly LanguagePack[] = PACKS,
): Generator<{ stem: string; index: number; length: number }> {
  for (const m of text.matchAll(TOKEN))
    yield { stem: stemToken(m[0], lang, packs), index: m.index, length: m[0].length };
}

/**
 * Query-side word tokens with their stem variants (ADR-0032 item 4): the query's language is
 * decided as a whole, else an ambiguous token gets one stem per pack that has a book in the
 * library (`libraryLangs`), identical stems merged. Without library languages each token has the
 * one stem stemText gives it.
 */
export function* queryStemmedTokens(
  query: string,
  libraryLangs?: ReadonlySet<string>,
  packs: readonly LanguagePack[] = PACKS,
): Generator<{ stems: string[]; index: number; length: number }> {
  const matches = [...query.matchAll(TOKEN)];
  const packsFor = queryPacks(
    matches.map((m) => m[0]).filter((t) => !isCode(t)),
    libraryLangs,
    packs,
  );
  for (const m of matches) {
    const lower = m[0].toLowerCase();
    const routed = isCode(m[0]) ? [] : packsFor(m[0]);
    const stems = routed.length === 0 ? [lower] : [...new Set(routed.map((p) => p.stem(lower)))];
    yield { stems, index: m.index, length: m[0].length };
  }
}
