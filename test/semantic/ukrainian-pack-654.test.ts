// The Ukrainian language pack (#654 L2, ADR-0032 item 5): Snowball 3.2.0's Ukrainian stemmer joins
// the inflections the Russian stemmer leaves apart (#654's table), a Russian quote in a Ukrainian
// book stems as Russian, and an ambiguous query ORs both packs only where Ukrainian books exist.

import { describe, expect, it } from "vitest";
import { detectBookLanguage } from "../../src/semantic/language/detect.js";
import { PACKS, stemVersion } from "../../src/semantic/language/registry.js";
import { ftsMatch } from "../../src/semantic/store/shared.js";
import { stemText, stemToken } from "../../src/semantic/stem.js";

describe("Ukrainian pack", () => {
  it("is compiled in after en and ru, so Cyrillic still defaults to Russian", () => {
    expect([PACKS.map((p) => p.id), stemVersion()]).toEqual([["en", "ru", "uk"], "en:1|ru:1|uk:1"]);
  });

  it.each([
    ["функція", "функції", "функці"],
    ["результат", "результатів", "результат"],
    ["потоки", "потоків", "поток"],
  ])("stems %s and %s to one stem in a Ukrainian book (%s)", (a, b, stem) => {
    expect([stemToken(a, "uk"), stemToken(b, "uk")]).toEqual([stem, stem]);
  });

  it("stems a Russian quote inside a Ukrainian book with the Russian stemmer", () => {
    expect(stemText("Він писав: вопросы", "uk")).toBe("він пис вопрос");
  });

  it("stems a Ukrainian word with Ukrainian letters as Ukrainian inside a Russian book", () => {
    // результатів has no і/ї/є/ґ, so it stays on the Russian stemmer
    expect([stemToken("функції", "ru"), stemToken("результатів", "ru")]).toEqual(["функці", "результатів"]);
  });

  it("detects a Ukrainian text as uk with the compiled-in packs", () => {
    const text =
      "Ця книга розповідає про функції та потоки. Кожна функція повертає результат, і цей результат " +
      "можна зберегти. Якщо потоків багато, їх треба узгоджувати.";
    expect(detectBookLanguage(text)).toBe("uk");
  });
});

describe("ambiguous query `мова програмування` (ADR-0032 item 4)", () => {
  it("ORs the Russian and Ukrainian stems in a library with Ukrainian books, identical stems merged", () => {
    expect(ftsMatch("мова програмування", new Set(["en", "ru", "uk"]))).toBe('"мов" OR "програмуван" OR "програм"');
  });

  it("keeps today's Russian-only stems in a library without Ukrainian books", () => {
    expect(ftsMatch("мова програмування", new Set(["en", "ru"]))).toBe('"мов" OR "програмуван"');
  });

  it("stems the whole query as Ukrainian when one word has Ukrainian letters", () => {
    expect(ftsMatch("кешування результатів функції", new Set(["ru", "uk"]))).toBe('"кешув" OR "результат" OR "функці"');
  });
});
