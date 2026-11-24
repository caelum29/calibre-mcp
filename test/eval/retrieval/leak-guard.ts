// Lexical-leak guard for #359's no-overlap-paraphrase queries: the content stems a query shares
// with a text. "Content" follows the snippet window's query-term rule (src/semantic/snippet.ts):
// the project stemmer, minus snippet.ts's own STOPWORDS and stems shorter than 3 characters.

import { STOPWORDS } from "../../../src/semantic/snippet.js";
import { stemmedTokens } from "../../../src/semantic/stem.js";
import { ftsMatch } from "../../../src/semantic/store/shared.js";

const MIN_TERM_CHARS = 3;

/** Distinct content stems of `query`, in query order. */
function contentStems(query: string): string[] {
  const out: string[] = [];
  for (const t of stemmedTokens(query)) {
    const raw = query
      .slice(t.index, t.index + t.length)
      .toLowerCase()
      .replaceAll("ё", "е");
    if (!STOPWORDS.has(raw) && t.stem.length >= MIN_TERM_CHARS && !out.includes(t.stem)) out.push(t.stem);
  }
  return out;
}

/**
 * The content stems of `query` that also occur as a stem anywhere in `text` — empty means the
 * keyword half can't match the query to that text at all.
 */
export function leakedStems(query: string, text: string): string[] {
  const inText = new Set([...stemmedTokens(text)].map((t) => t.stem));
  return contentStems(query).filter((s) => inText.has(s));
}

// A raw token as the index tokenizer sees it (store/shared.ts RAW_TOKEN): the identifier tokens
// ftsMatch ORs in (#634) match the raw column, so the text side is compared raw too.
const RAW_TOKEN = /[\p{L}\p{N}\p{M}_+#.-]+/gu;

/** The tokens ftsMatch ORs for `query`: its stems plus identifier-like raw tokens (and their "t." form). */
function ftsTokens(query: string): string[] {
  const expr = ftsMatch(query);
  if (!expr) return [];
  return [...expr.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]!.replaceAll('""', '"'));
}

/**
 * Every token the keyword half ORs for `query` (ftsMatch: stems, stop words and short stems
 * included, plus identifier tokens such as `three-way` or `node.js`) that also occurs in
 * `text`, as a stem or as a raw token. Only an empty result keeps keyword search from returning
 * `text` for this query at all. A sentence-final `t.` collapses into `t`.
 */
export function ftsOverlap(query: string, text: string): string[] {
  const stems = new Set([...stemmedTokens(text)].map((t) => t.stem));
  const raw = new Set([...text.matchAll(RAW_TOKEN)].map((m) => m[0].toLowerCase()));
  const out: string[] = [];
  for (const tok of ftsTokens(query)) {
    if (!stems.has(tok) && !raw.has(tok)) continue;
    const key = tok.replace(/\.+$/, "");
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}
