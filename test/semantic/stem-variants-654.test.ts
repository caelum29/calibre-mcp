// Stem wrapper over the language routing (#654 L2): index-side stemming in a book's language and
// query-side stem variants (one stem per candidate pack, identical stems merged). Routed over the
// real en/ru packs plus stub uk packs.

import { describe, expect, it } from "vitest";
import { en } from "../../src/semantic/language/en.js";
import type { LanguagePack } from "../../src/semantic/language/pack.js";
import { ru } from "../../src/semantic/language/ru.js";
import { queryStemmedTokens, stemText } from "../../src/semantic/stem.js";

const uk: LanguagePack = {
  id: "uk",
  version: 1,
  script: "Cyrillic",
  distinctiveLetters: "іїєґ",
  stopwords: new Set(["та"]),
  stem: (w) => `uk:${w}`,
};
const WITH_UK: readonly LanguagePack[] = [en, ru, uk];

const variants = (query: string, langs?: readonly string[], packs = WITH_UK) =>
  [...queryStemmedTokens(query, langs ? new Set(langs) : undefined, packs)].map((t) => t.stems);

describe("index side: stemText in the book's language", () => {
  it("stems a Ukrainian book's words as Ukrainian, a Russian quote as Russian, Latin as English", () => {
    expect(stemText("Мова вопросы functions", "uk", WITH_UK)).toBe(
      `uk:мова ${ru.stem("вопросы")} ${en.stem("functions")}`,
    );
  });

  it("leaves identifiers raw whatever the book language", () => {
    expect(stemText("utf8 __init__ camelCase", "uk", WITH_UK)).toBe("utf8 __init__ camelcase");
  });
});

describe("query side: stem variants per token", () => {
  it("gives an ambiguous Cyrillic token one stem per candidate pack, in pack order", () => {
    expect(variants("мова програмування", ["ru", "uk"])).toEqual([
      [ru.stem("мова"), "uk:мова"],
      [ru.stem("програмування"), "uk:програмування"],
    ]);
  });

  it("merges identical stems into one", () => {
    const ukSameAsRu: LanguagePack = { ...uk, stem: (w) => ru.stem(w) };
    expect(variants("мова", ["ru", "uk"], [en, ru, ukSameAsRu])).toEqual([[ru.stem("мова")]]);
  });

  it("keeps one stem per token when the query decides its language", () => {
    expect(variants("кешування функції", ["ru", "uk"])).toEqual([["uk:кешування"], ["uk:функції"]]);
  });

  it("keeps identifiers raw, with a single variant", () => {
    expect(variants("utf8 мова", ["ru", "uk"])).toEqual([["utf8"], [ru.stem("мова"), "uk:мова"]]);
  });

  it("reports each token's position in the query", () => {
    expect([...queryStemmedTokens("ab, мова", new Set(["ru"]), WITH_UK)].map((t) => [t.index, t.length])).toEqual([
      [0, 2],
      [4, 4],
    ]);
  });
});
