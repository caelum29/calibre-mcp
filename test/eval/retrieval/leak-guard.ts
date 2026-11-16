// Lexical-leak guard for #359's no-overlap-paraphrase queries: the content stems a query shares
// with a text. "Content" follows the snippet window's query-term rule (src/semantic/snippet.ts):
// the project stemmer, minus stop words and stems shorter than 3 characters. The stop-word list
// is a copy (snippet.ts stays untouched tonight); leak-guard-sync.test.ts fails if they drift.

import { stemmedTokens } from "../../../src/semantic/stem.js";

const MIN_TERM_CHARS = 3;

// Copy of snippet.ts STOPWORDS (lowercased raw tokens, ё→е).
const STOPWORDS = new Set(
  (
    "a an the and or but nor not no so if then than as at by for from in into of off on onto out " +
    "over to up with about after before under between through during without within is am are was " +
    "were be been being do does did doing done have has had having can could will would shall should " +
    "may might must how what when where which who whom whose why this that these those there here it " +
    "its they them their we our you your he she his her i me my all any some each every both few more " +
    "most other such only own same too very just also use used using via vs " +
    "и в во на с со к ко у о об от до по за из изо для без над под при про через между а но или либо " +
    "да нет не ни же ли бы то это этот эта эти тот та те так как что чтобы кто где когда зачем почему " +
    "какой какая какие чем там тут здесь уже еще ещё был была были было быть есть будет он она оно они " +
    "мы вы ты я его ее её их им ему ей нас вас все всё весь вся всех свой своя свои также тоже очень " +
    "можно нужно надо"
  )
    .split(" ")
    .map((w) => w.replace(/ё/g, "е")),
);

/** Stop words of the guard, exported for the sync test against snippet.ts. */
export const LEAK_GUARD_STOPWORDS: ReadonlySet<string> = STOPWORDS;

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
