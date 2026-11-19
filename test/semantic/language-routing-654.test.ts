// Language routing for the keyword half (#654 L2, ADR-0032 items 2–4, 6): book language from text,
// index-side token → pack, query-side packs per token, stem version. Routed over the real en/ru
// packs plus a stub uk pack (the generated Snowball Ukrainian stemmer is vendored separately).

import { describe, expect, it } from "vitest";
import { detectBookLanguage } from "../../src/semantic/language/detect.js";
import { en } from "../../src/semantic/language/en.js";
import type { LanguagePack } from "../../src/semantic/language/pack.js";
import { packForToken, PACKS, queryPacks, stemVersion } from "../../src/semantic/language/registry.js";
import { ru } from "../../src/semantic/language/ru.js";

const uk: LanguagePack = {
  id: "uk",
  version: 1,
  script: "Cyrillic",
  distinctiveLetters: "іїєґ",
  stopwords: new Set("і й та що як це він вона вони на в у з до від не".split(" ")),
  stem: (w) => `uk:${w}`,
};
const WITH_UK: readonly LanguagePack[] = [en, ru, uk];

const indexPack = (token: string, bookLang?: string) => packForToken(token, bookLang, WITH_UK)?.id;

describe("index side: token → pack (ADR-0032 item 3)", () => {
  it.each([
    ["мова", "uk", "uk"], // ambiguous word in a Ukrainian book → the book's pack
    ["функції", "uk", "uk"],
    ["вопросы", "uk", "ru"], // a Russian quote in a Ukrainian book switches to Russian
    ["ёлка", "uk", "ru"],
    ["її", "ru", "uk"], // a Ukrainian word in a Russian book switches to Ukrainian
    ["ЇЖАК", "ru", "uk"], // distinctive letters are checked case-insensitively
    ["мова", "ru", "ru"],
    ["мова", undefined, "ru"], // no book language → the script's default pack
    ["мова", "en", "ru"], // an English book has no Cyrillic pack of its own → default
    ["функції", "en", "uk"],
    ["running", "uk", "en"],
    ["running", undefined, "en"],
  ])("%s in a %s book → %s", (token, bookLang, want) => {
    expect(indexPack(token, bookLang)).toBe(want);
  });

  it("gives digits and other scripts no pack", () => {
    expect([indexPack("42", "uk"), indexPack("日本", "uk"), indexPack("Ωμέγα", "uk")]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

/** Pack ids per query token, in query order. */
function queryIds(query: string, libraryLangs?: readonly string[]): string[][] {
  const tokens = query.split(" ");
  const packsFor = queryPacks(tokens, libraryLangs ? new Set(libraryLangs) : undefined, WITH_UK);
  return tokens.map((t) => packsFor(t).map((p) => p.id));
}

describe("query side: packs per token, decided for the whole query (ADR-0032 item 4)", () => {
  it("ORs an ambiguous query over every Cyrillic pack with books in the library", () => {
    expect(queryIds("мова програмування", ["en", "ru", "uk"])).toEqual([
      ["ru", "uk"],
      ["ru", "uk"],
    ]);
  });

  it("uses only Russian when the library has no Ukrainian book", () => {
    expect(queryIds("мова програмування", ["en", "ru"])).toEqual([["ru"], ["ru"]]);
  });

  it("en books keep the Cyrillic default ru as a candidate", () => {
    expect(queryIds("мова програмування", ["uk", "en"])).toEqual([
      ["ru", "uk"],
      ["ru", "uk"],
    ]);
  });

  it("falls back to the default pack when no Cyrillic pack has a book, or languages are unknown", () => {
    expect([queryIds("мова", ["en"]), queryIds("мова")]).toEqual([[["ru"]], [["ru"]]]);
  });

  it("sends every Cyrillic token to Ukrainian when one token has Ukrainian letters", () => {
    expect(queryIds("кешування результатів функції", ["en", "ru", "uk"])).toEqual([["uk"], ["uk"], ["uk"]]);
  });

  it("sends every Cyrillic token to Russian when one token has Russian letters", () => {
    expect(queryIds("язык программирования", ["ru", "uk"])).toEqual([["ru"], ["ru"]]);
  });

  it("routes each token by its own letters when the evidence conflicts", () => {
    expect(queryIds("вопросы її мова", ["ru", "uk"])).toEqual([["ru"], ["uk"], ["ru", "uk"]]);
  });

  it("keeps Latin tokens on English whatever the Cyrillic evidence", () => {
    expect(queryIds("rust функції мова", ["en", "ru", "uk"])).toEqual([["en"], ["uk"], ["uk"]]);
  });

  it("gives digits no pack", () => {
    expect(queryIds("42 мова", ["ru", "uk"])).toEqual([[], ["ru", "uk"]]);
  });
});

describe("stem version (ADR-0032 item 6)", () => {
  it("names every pack and its version in registry order", () => {
    expect(stemVersion(WITH_UK)).toBe("en:1|ru:1|uk:1");
  });

  it("describes the compiled-in packs by default", () => {
    expect(stemVersion()).toBe(PACKS.map((p) => `${p.id}:${p.version}`).join("|"));
  });
});

// Self-authored sample paragraphs (not from any book).
const UK_TEXT =
  "Ця книга розповідає про функції та потоки. Кожна функція повертає результат, і цей результат " +
  "можна зберегти. Якщо потоків багато, їх треба узгоджувати, бо інакше виникає взаємне блокування. " +
  "Розділ четвертий пояснює, як уникнути помилок і як перевірити програму.";
const RU_TEXT =
  "Эта книга рассказывает о функциях и потоках. Каждая функция возвращает результат, который можно " +
  "сохранить. Если потоков много, их нужно согласовывать, иначе возникает взаимная блокировка. " +
  "Четвёртая глава объясняет, как избежать ошибок и как проверить программу.";
const EN_TEXT =
  "This book explains functions and threads. Every function returns a result that can be cached. " +
  "When there are many threads they must be coordinated, or a deadlock appears.";

const detect = (text: string) => detectBookLanguage(text, WITH_UK);

describe("book language from text (ADR-0032 item 2)", () => {
  it("detects Ukrainian, Russian and English prose", () => {
    expect([detect(UK_TEXT), detect(RU_TEXT), detect(EN_TEXT)]).toEqual(["uk", "ru", "en"]);
  });

  it("keeps a Ukrainian book Ukrainian when it quotes Russian", () => {
    expect(detect(`${UK_TEXT} Автор цитує: «Это было очень давно». ${UK_TEXT}`)).toBe("uk");
  });

  it("keeps a Russian book Russian when it quotes Ukrainian", () => {
    expect(detect(`${RU_TEXT} Автор цитирует: «Це було дуже давно». ${RU_TEXT}`)).toBe("ru");
  });

  it("falls back to stop words when neither pack's distinctive letters appear", () => {
    expect([detect("книга та полиця, книга та стола, що та як"), detect("книга и полка, книга и стол")]).toEqual([
      "uk",
      "ru",
    ]);
  });

  it("takes the dominant script: an English book with a Cyrillic word stays English", () => {
    expect(detect(`${EN_TEXT} The Ukrainian word функції means functions.`)).toBe("en");
  });

  it("returns undefined for text with no Latin or Cyrillic letters", () => {
    expect([detect(""), detect("123 456 — 789"), detect("日本語のテキスト")]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
