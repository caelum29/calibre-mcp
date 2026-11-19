// Book language from text (ADR-0032 item 2, #654): dominant script, then distinctive letters,
// then the share of each candidate pack's stop words. Calibre's `languages` field is not read:
// it is often missing or wrong in this library, while the text is what gets stemmed.

import type { LanguagePack, Script } from "./pack.js";
import { PACKS } from "./registry.js";

// Three windows from inside the book: a cover page, an English imprint or an index at either end
// would otherwise outvote the body. Basis: heuristic, not measured — 3 × 40k chars is plenty of
// letters for the counts below and keeps detection linear in a bounded sample.
const WINDOW_CHARS = 40_000;
const WINDOW_AT = [0.25, 0.5, 0.75];
// Distinctive letters decide only when one pack has this many times the runner-up's count: a
// quote in the other language must not flip the book, and pre-reform Russian uses і alongside ы.
// Basis: heuristic, not measured.
const LETTER_DOMINANCE = 3;

const SCRIPT_LETTER: Record<Script, RegExp> = {
  Latin: /\p{Script=Latin}/gu,
  Cyrillic: /\p{Script=Cyrillic}/gu,
};
// non-global twins of SCRIPT_LETTER, for testing one word (a /g regex keeps lastIndex between calls)
const SCRIPT_TEST: Record<Script, RegExp> = {
  Latin: /\p{Script=Latin}/u,
  Cyrillic: /\p{Script=Cyrillic}/u,
};
const WORD = /\p{L}+/gu;

function sampleOf(text: string): string {
  if (text.length <= WINDOW_CHARS * WINDOW_AT.length) return text;
  return WINDOW_AT.map((at) => {
    const from = Math.floor(text.length * at - WINDOW_CHARS / 2);
    return text.slice(from, from + WINDOW_CHARS);
  }).join(" ");
}

function dominantScript(sample: string): Script | undefined {
  let best: Script | undefined;
  let bestCount = 0;
  for (const script of Object.keys(SCRIPT_LETTER) as Script[]) {
    const n = sample.match(SCRIPT_LETTER[script])?.length ?? 0;
    if (n > bestCount) [best, bestCount] = [script, n];
  }
  return best;
}

/** Packs ranked by how often their distinctive letters occur in `lower`, most first. */
function byLetters(lower: string, candidates: readonly LanguagePack[]): { pack: LanguagePack; n: number }[] {
  return candidates
    .map((pack) => ({ pack, n: [...lower].filter((ch) => pack.distinctiveLetters.includes(ch)).length }))
    .sort((a, b) => b.n - a.n);
}

/** The candidate with the largest share of stop words among the script's words; ties keep the default. */
function byStopwords(lower: string, script: Script, candidates: readonly LanguagePack[]): LanguagePack {
  const words = (lower.match(WORD) ?? []).filter((w) => SCRIPT_TEST[script].test(w)).map((w) => w.replace(/ё/g, "е"));
  let best = candidates[0]!;
  let bestHits = -1;
  for (const pack of candidates) {
    const hits = words.filter((w) => pack.stopwords.has(w)).length;
    if (hits > bestHits) [best, bestHits] = [pack, hits];
  }
  return best;
}

/** The book's language pack id from its text; undefined when the text has no Latin or Cyrillic letters. */
export function detectBookLanguage(text: string, packs: readonly LanguagePack[] = PACKS): string | undefined {
  const sample = sampleOf(text);
  const script = dominantScript(sample);
  if (script === undefined) return undefined;
  const candidates = packs.filter((p) => p.script === script);
  if (candidates.length <= 1) return candidates[0]?.id;
  const lower = sample.toLowerCase();
  const [top, next] = byLetters(lower, candidates);
  if (top && top.n > 0 && top.n >= LETTER_DOMINANCE * (next?.n ?? 0)) return top.pack.id;
  return byStopwords(lower, script, candidates).id;
}
