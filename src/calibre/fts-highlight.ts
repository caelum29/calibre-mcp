// Repairs FTS snippets whose highlight markers Calibre put on the wrong words (#308).
// Calibre's /fts/snippets sometimes shifts the markers right of the real match (suspected
// byte-vs-char offsets after non-ASCII text). Until that is fixed upstream, highlights unrelated
// to the query are stripped and the query re-highlighted around the valid ones; good snippets
// pass through byte-identical.

import { foldAccents } from "../domain/curation/normalize.js";

/** Highlight marker pair the snippets were requested with. */
export interface HighlightMarkers {
  start: string;
  end: string;
}

/** One query match unit: a quoted phrase (several words in order) or a single bare word. */
interface QueryUnit {
  words: string[];
  prefix: boolean;
}

// FTS5 operators are case-sensitive keywords; lowercase "and" is an ordinary term.
const OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);
const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Repair snippets whose highlights don't belong to `query`. A snippet without a highlight, or
 * whose every highlight matches a query term, is returned unchanged.
 */
export function repairSnippets(query: string, snippets: string[], markers: HighlightMarkers): string[] {
  const units = parseQuery(query);
  if (units.length === 0) return snippets;
  // Only a tight span (`>>word<<`, no space just inside either marker, one line) is a Calibre
  // highlight; loose `>>`/`<<` are book text such as C++ stream operators and stay untouched.
  const bad = `[${escapeRe(markers.start + markers.end)}\\s]`;
  const ok = `[^${escapeRe(markers.start + markers.end)}\\n]`;
  const inner = `(?!${bad})(${ok}*?)(?<!${bad})`;
  const span = new RegExp(`${escapeRe(markers.start)}${inner}${escapeRe(markers.end)}`, "gu");
  return snippets.map((s) => repairOne(s, units, span, markers));
}

/** Keep valid highlights, unmark bad ones, re-highlight the query in the unmarked stretches. */
function repairOne(snippet: string, units: QueryUnit[], span: RegExp, markers: HighlightMarkers): string {
  const spans = [...snippet.matchAll(span)].filter((m) => m[1]);
  // No highlight → never inject one; all valid → Calibre got it right.
  if (spans.every((m) => spanIsValid(m[1]!, units))) return snippet;
  let out = "";
  let plain = "";
  let cursor = 0;
  for (const m of spans) {
    plain += snippet.slice(cursor, m.index);
    cursor = m.index + m[0].length;
    if (spanIsValid(m[1]!, units)) {
      out += highlight(plain, units, markers) + m[0];
      plain = "";
    } else {
      plain += m[1];
    }
  }
  return out + highlight(plain + snippet.slice(cursor), units, markers);
}

// A span is a real highlight when each of its words matches some query term.
function spanIsValid(inner: string, units: QueryUnit[]): boolean {
  const words = inner.match(WORD) ?? [];
  return words.every((w) => units.some((u) => u.words.some((t) => wordMatches(w, t, u.prefix))));
}

/** Wrap every occurrence of a query unit (phrase words in order) in the markers. */
function highlight(text: string, units: QueryUnit[], { start, end }: HighlightMarkers): string {
  const words = [...text.matchAll(WORD)];
  // Longest phrases first, so "event sourcing" wins over a bare "event".
  const ordered = [...units].sort((a, b) => b.words.length - a.words.length);
  let out = "";
  let cursor = 0;
  let i = 0;
  while (i < words.length) {
    const unit = ordered.find((u) =>
      u.words.every((t, k) => words[i + k] && wordMatches(words[i + k]![0], t, u.prefix)),
    );
    if (!unit) {
      i++;
      continue;
    }
    const first = words[i]!;
    const last = words[i + unit.words.length - 1]!;
    const from = first.index;
    const to = last.index + last[0].length;
    out += `${text.slice(cursor, from)}${start}${text.slice(from, to)}${end}`;
    cursor = to;
    i += unit.words.length;
  }
  return out + text.slice(cursor);
}

/** Query → match units: quoted phrases, then bare words; operators and NEAR distances dropped. */
function parseQuery(query: string): QueryUnit[] {
  const units: QueryUnit[] = [];
  const rest = query
    .replace(/,\s*\d+\s*\)/g, ")") // NEAR(... , 30) distance
    .replace(/"([^"]*)"/g, (_, phrase: string) => {
      const words = phrase.match(WORD) ?? [];
      if (words.length) units.push({ words, prefix: false });
      return " ";
    });
  for (const token of rest.split(/[\s()]+/)) {
    if (!token || OPERATORS.has(token)) continue;
    const prefix = token.endsWith("*");
    for (const w of token.match(WORD) ?? []) units.push({ words: [w], prefix });
  }
  return units;
}

// Case-, diacritic- and stem-tolerant, and lenient on purpose: Calibre matches stemmed
// (porter), and a false "valid" only keeps Calibre's own output, while a false "invalid"
// would strip a correct highlight.
function wordMatches(word: string, term: string, prefix: boolean): boolean {
  const w = fold(word);
  const t = fold(term);
  if (w === t) return true;
  if (prefix) return w.startsWith(t);
  if (stem(w) === stem(t)) return true;
  const shorter = Math.min(w.length, t.length);
  const cp = commonPrefix(w, t);
  // Short words: only a short inflection ("api"→"apis"), not "the"→"theory".
  if (shorter < 4) return cp === shorter && Math.abs(w.length - t.length) <= 2;
  return cp >= Math.max(4, shorter - 3);
}

// Lowercase first: foldAccents folds only lowercase ё, so Ё must be lowered before it.
function fold(s: string): string {
  return foldAccents(s.toLowerCase());
}

const SUFFIXES = ["ations", "ation", "ings", "ing", "edly", "ed", "ers", "er", "ly", "es", "s"];

/** Rough English stem: strip one inflection, undouble a final consonant, drop a final e. */
function stem(w: string): string {
  let s = w;
  for (const suf of SUFFIXES) {
    if (s.endsWith(suf) && s.length - suf.length >= 2) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  if (/([b-df-hj-np-tv-z])\1$/.test(s)) s = s.slice(0, -1); // running → runn → run
  if (s.endsWith("e") && s.length > 2) s = s.slice(0, -1); // making → mak ← make
  return s;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
