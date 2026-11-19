// Equivalence proof for the language-pack registry refactor (#654 L1, ADR-0032): stemToken over
// the registry must stay byte-identical to the pre-refactor function on every word of the eval
// fixture (books + queries), and the snippet stop words must be the same set.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import snowball from "snowball-stemmers";
import { describe, expect, it } from "vitest";
import { en } from "../../src/semantic/language/en.js";
import { ru } from "../../src/semantic/language/ru.js";
import { STOPWORDS } from "../../src/semantic/snippet.js";
import { stemToken } from "../../src/semantic/stem.js";

// ---- Frozen copy of src/semantic/stem.ts stemToken before #654 (commit ac72aedd). Never edit. ----
const frozenRu = snowball.newStemmer("russian");
const frozenEn = snowball.newStemmer("english");
function frozenIsCode(tok: string): boolean {
  if (/[\d_]/.test(tok)) return true;
  return /\p{Ll}\p{Lu}/u.test(tok);
}
function frozenStemToken(tok: string): string {
  const lower = tok.toLowerCase();
  if (frozenIsCode(tok)) return lower;
  if (/\p{Script=Cyrillic}/u.test(tok)) return frozenRu.stem(lower.replace(/ё/g, "е"));
  if (/\p{Script=Latin}/u.test(tok)) return frozenEn.stem(lower);
  return lower;
}
// ---- Frozen copy of src/semantic/snippet.ts STOPWORDS before #654 (commit ac72aedd). ----
const FROZEN_STOPWORDS = new Set(
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

const FIXTURE = join(import.meta.dirname, "../eval/retrieval");

/** Every distinct word token of the fixture's book texts and query strings. */
function fixtureVocabulary(): string[] {
  const texts = readdirSync(join(FIXTURE, "corpus"))
    .filter((f) => f.endsWith(".txt"))
    .map((f) => readFileSync(join(FIXTURE, "corpus", f), "utf8"));
  const queries = JSON.parse(readFileSync(join(FIXTURE, "queries.json"), "utf8")) as { query: string }[];
  const words = new Set<string>();
  for (const t of [...texts, ...queries.map((q) => q.query)]) {
    for (const m of t.matchAll(/[\p{L}\p{N}_]+/gu)) words.add(m[0]);
  }
  return [...words].sort();
}

describe("language-pack registry is byte-identical to the pre-#654 stemmer", () => {
  const vocab = fixtureVocabulary();
  // Edge cases the fixture may not hold: ё, mixed script, camelCase, digits, other scripts.
  const extras = [
    "ёлки",
    "Ёжик",
    "ещё",
    "Cофт",
    "sofтware",
    "ConsumerRebalanceListener",
    "utf8",
    "__init__",
    "Ωmega",
    "日本",
    "42",
    "ⅰⅱ",
    "ﬁle",
    "Straße",
  ];

  it("covers both scripts with a non-trivial word list", () => {
    expect(vocab.filter((w) => /\p{Script=Cyrillic}/u.test(w)).length).toBeGreaterThan(500);
    expect(vocab.filter((w) => /\p{Script=Latin}/u.test(w)).length).toBeGreaterThan(2000);
  });

  it("stems every fixture word and edge case exactly as before", () => {
    const diffs = [...vocab, ...extras]
      .map((w) => ({ w, before: frozenStemToken(w), after: stemToken(w) }))
      .filter((d) => d.before !== d.after);
    expect(diffs).toEqual([]);
  });

  // #654 L2 added the uk pack's stop words to STOPWORDS on purpose; the en and ru lists stay as they were
  it("keeps the English and Russian snippet stop words unchanged, all still in STOPWORDS", () => {
    const enRu = new Set([...en.stopwords, ...ru.stopwords]);
    expect({ enRu: [...enRu].sort(), missing: [...FROZEN_STOPWORDS].filter((w) => !STOPWORDS.has(w)) }).toEqual({
      enRu: [...FROZEN_STOPWORDS].sort(),
      missing: [],
    });
  });
});
