// Lexical-leak guard for #359's no-overlap-paraphrase queries: the content stems a query shares
// with a text. "Content" follows the snippet window's query-term rule (src/semantic/snippet.ts):
// the project stemmer, minus snippet.ts's own STOPWORDS and stems shorter than 3 characters.

import { STOPWORDS } from "../../../src/semantic/snippet.js";
import { stemmedTokens } from "../../../src/semantic/stem.js";

const MIN_TERM_CHARS = 3;

/** Distinct content stems of `query`, in query order. */
function contentStems(query: string): string[] {
  const out: string[] = [];
  for (const t of stemmedTokens(query)) {
    const raw = query
      .slice(t.index, t.index + t.length)
      .toLowerCase()
      .replace(/ё/g, "е");
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
