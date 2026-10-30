import { describe, expect, it } from "vitest";
import type { Book } from "../../../src/domain/book.js";
import { compareBooks, findDuplicateGroups, mergeSafety } from "../../../src/domain/curation/duplicates.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

describe("findDuplicateGroups", () => {
  it("groups books that share an identical key and ignores singletons", () => {
    const books = [
      book({ id: 1, title: "Rust", authors: ["A"], formats: ["pdf"] }),
      book({ id: 2, title: "rust", authors: ["a"], formats: ["epub"] }),
      book({ id: 3, title: "Go", authors: ["B"] }),
    ];
    const groups = findDuplicateGroups(books, "identical");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.books.map((b) => b.id).sort()).toEqual([1, 2]);
  });

  it("groups fuzzily in similar mode", () => {
    const books = [
      book({ id: 1, title: "The Rust Programming Language", authors: ["A"] }),
      book({ id: 2, title: "Rust Programming Language: 2nd Ed", authors: ["A"] }),
    ];
    expect(findDuplicateGroups(books, "identical")).toHaveLength(0);
    expect(findDuplicateGroups(books, "similar")).toHaveLength(1);
  });

  it("sorts least-safe groups first", () => {
    const safe = [
      book({ id: 1, title: "Safe", authors: ["A"], formats: ["pdf"] }),
      book({ id: 2, title: "Safe", authors: ["A"], formats: ["epub"] }),
    ];
    const risky = [
      book({ id: 3, title: "Risky", authors: ["B"], identifiers: { isbn: "111" } }),
      book({ id: 4, title: "Risky", authors: ["B"], identifiers: { isbn: "222" } }),
    ];
    const groups = findDuplicateGroups([...safe, ...risky], "identical");
    expect(groups[0]!.books[0]!.title).toBe("Risky");
  });
});

// #241 repro (live library, 2026-10-30): non-Latin keys used to collapse to "|" / "|unknown".
describe("findDuplicateGroups similar mode with non-Latin metadata (#241)", () => {
  it("should_not_group_unrelated_russian_books", () => {
    const books = [
      book({ id: 1116, title: "Векторные базы данных: разработка и применение", authors: ["Ло Юнь"] }),
      book({ id: 1001, title: "Врата Европы. История Украины", authors: ["Сергей Николаевич Плохий"] }),
      book({ id: 1115, title: "Грокаем алгоритмы", authors: ["Адитья Бхаргава"] }),
      book({ id: 1176, title: "Чистый код", authors: ["Роберт Мартин"] }),
      book({ id: 1177, title: "Совершенный код", authors: ["Стив Макконнелл"] }),
      book({ id: 1053, title: "Паттерны проектирования", authors: ["Эрих Гамма"] }),
    ];
    expect(findDuplicateGroups(books, "similar")).toEqual([]);
  });

  it("should_not_group_different_cyrillic_titles_on_an_unknown_author", () => {
    const books = [
      book({ id: 1163, title: "Искусственный интеллект для чайников", authors: ["Unknown"] }),
      book({ id: 37, title: "Максимальная производительность архитектурные подходы", authors: ["Unknown"] }),
      book({ id: 1120, title: "Высоконагруженные приложения", authors: ["Unknown"] }),
      book({ id: 1060, title: "Изучаем Rust", authors: ["Unknown"] }),
    ];
    expect(findDuplicateGroups(books, "similar")).toEqual([]);
  });

  it("should_group_only_the_true_duplicate_volume_of_you_dont_know_js", () => {
    const books = [
      book({ id: 1152, title: "Вы не знаете JS: Асинхронная обработка и оптимизация", authors: ["Kyle Simpson"] }),
      book({ id: 682, title: "Вы не знаете JS Замыкания и объекты", authors: ["Kyle Simpson"] }),
      book({ id: 1154, title: "Вы не знаете JS. Замыкания и объекты", authors: ["Kyle Simpson"] }),
      book({ id: 1153, title: "Вы не знаете JS: Типы и грамматические конструкции", authors: ["Kyle Simpson"] }),
    ];
    const groups = findDuplicateGroups(books, "similar");
    const withClosures = groups.find((g) => g.books.some((b) => b.id === 682));
    expect(withClosures?.books.map((b) => b.id).sort()).toEqual([1154, 682]);
  });

  it("should_never_group_books_whose_title_normalizes_to_empty_on_author_alone", () => {
    const books = [
      book({ id: 1, title: "", authors: ["Unknown"] }),
      book({ id: 2, title: "???", authors: ["Unknown"] }),
      book({ id: 3, title: "«…»", authors: ["Unknown"] }),
      book({ id: 4, title: "", authors: [] }),
      book({ id: 5, title: "—", authors: [] }),
    ];
    expect(findDuplicateGroups(books, "similar")).toEqual([]);
  });
});

describe("mergeSafety", () => {
  it("is 1 for consistent records with distinct formats", () => {
    const books = [book({ formats: ["pdf"] }), book({ formats: ["epub"] })];
    expect(mergeSafety(books)).toBe(1);
  });

  it("deducts for conflicting ISBNs", () => {
    const books = [book({ identifiers: { isbn: "111" } }), book({ identifiers: { isbn: "222" } })];
    expect(mergeSafety(books)).toBeCloseTo(0.5);
  });

  it("deducts for a shared format", () => {
    const books = [book({ formats: ["pdf"] }), book({ formats: ["pdf"] })];
    expect(mergeSafety(books)).toBeCloseTo(0.8);
  });

  it("caps a differing-language pair below the safe-merge range", () => {
    const books = [book({ languages: ["eng"], formats: ["pdf"] }), book({ languages: ["rus"], formats: ["epub"] })];
    expect(mergeSafety(books)).toBeLessThanOrEqual(0.3);
  });

  it("clamps to 0 when many signals conflict", () => {
    const books = [
      book({ identifiers: { isbn: "111" }, languages: ["en"], formats: ["pdf"] }),
      book({ identifiers: { isbn: "222" }, languages: ["ru"], formats: ["pdf"] }),
    ];
    expect(mergeSafety(books)).toBe(0);
  });
});

describe("compareBooks", () => {
  it("diffs fields and recommends the most complete record", () => {
    const books = [
      book({ id: 1, title: "T", authors: ["A"], formats: ["pdf"] }),
      book({
        id: 2,
        title: "T",
        authors: ["A"],
        formats: ["pdf", "epub"],
        identifiers: { isbn: "9780306406157" },
        publisher: "P",
      }),
    ];
    const r = compareBooks(books);
    expect(r.keep).toBe(2);
    const title = r.diffs.find((d) => d.field === "title")!;
    expect(title.agree).toBe(true);
    const formats = r.diffs.find((d) => d.field === "formats")!;
    expect(formats.agree).toBe(false);
  });

  it("diffs languages so a translation is not mistaken for a duplicate", () => {
    const books = [
      book({ id: 1, title: "T", authors: ["A"], languages: ["eng"], formats: ["pdf"] }),
      book({ id: 2, title: "T", authors: ["A"], languages: ["rus"], formats: ["pdf"] }),
    ];
    const languages = compareBooks(books).diffs.find((d) => d.field === "languages")!;
    expect(languages.agree).toBe(false);
    expect(languages.values).toEqual(["eng", "rus"]);
  });
});
