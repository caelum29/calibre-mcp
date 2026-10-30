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

// #242: edition-aware similar grouping. A signal (edition number, title year, subtitle,
// pubdate year) only separates two books when BOTH carry it and the values differ.
describe("findDuplicateGroups similar mode with editions (#242)", () => {
  const ids = (books: Book[]) =>
    findDuplicateGroups(books, "similar")
      .map((g) => g.books.map((b) => b.id).sort((x, y) => x - y))
      .sort((x, y) => x[0]! - y[0]!);
  const pair = (a: string, b: string, authors = ["Robert Martin"]) =>
    ids([book({ id: 1, title: a, authors }), book({ id: 2, title: b, authors })]);

  it("should_group_a_title_with_an_edition_and_year_suffix_with_the_bare_title", () => {
    const authors = ["Mario Casciaro", "Luciano Mammino"];
    const books = [
      book({ id: 973, title: "Node.js Design Patterns", authors }),
      book({
        id: 143,
        title: "NodeJS Design Patterns 3rd Edition 2020",
        authors,
        pubdate: "2020-07-27T07:53:52+00:00",
      }),
    ];
    expect(ids(books)).toEqual([[143, 973]]);
  });

  it("should_not_group_editions_published_years_apart", () => {
    const books = [
      book({
        id: 974,
        title: "Designing Distributed Systems",
        authors: ["Brendan Burns"],
        pubdate: "2018-02-12T14:13:38+00:00",
      }),
      book({
        id: 757,
        title: "Designing Distributed Systems: Patterns and Paradigms for Scalable, Reliable Systems Using Kubernetes",
        authors: ["Brendan Burns"],
        identifiers: { isbn: "9781098156350" },
        pubdate: "2025-01-06T22:00:00+00:00",
      }),
    ];
    expect(ids(books)).toEqual([]);
  });

  it("should_not_group_database_systems_editions_with_different_isbns_and_years", () => {
    const books = [
      book({
        id: 823,
        title: "Database Systems",
        authors: ["Carlos. Coronel", "Steven Morris"],
        identifiers: { isbn: "9780357673034" },
        pubdate: "2022-12-14T22:00:00+00:00",
      }),
      book({
        id: 494,
        title: "Database Systems: Design, Implementation, & Management",
        authors: ["Carlos Coronel", "Steven Morris"],
        identifiers: { isbn: "9781337627900" },
        pubdate: "2017-12-31T22:00:00+00:00",
      }),
    ];
    expect(ids(books)).toEqual([]);
  });

  it("should_group_only_the_two_closures_volumes_of_you_dont_know_js", () => {
    const authors = ["Kyle Simpson"];
    const books = [
      book({
        id: 1152,
        title: "Вы не знаете JS: Асинхронная обработка и оптимизация",
        authors,
        pubdate: "2019-05-13T16:35:33+00:00",
      }),
      book({ id: 682, title: "Вы не знаете JS Замыкания и объекты", authors, identifiers: { isbn: "9785446112555" } }),
      book({ id: 1154, title: "Вы не знаете JS. Замыкания и объекты", authors }),
      book({ id: 1153, title: "Вы не знаете JS: Типы и грамматические конструкции", authors }),
    ];
    expect(ids(books)).toEqual([[682, 1154]]);
  });

  it.each([
    "Clean Architecture 3rd Edition",
    "Clean Architecture, Third Edition",
    "Clean Architecture 3e",
    "Clean Architecture (3rd ed.)",
    "Clean Architecture, 2nd ed.",
    "Clean Architecture: 2nd Edition",
    "Clean Architecture 3rd Edition 2020",
  ])("should_group_%s_with_the_bare_title", (title) => {
    expect(pair("Clean Architecture", title)).toEqual([[1, 2]]);
  });

  it.each([
    ["Чистая архитектура", "Чистая архитектура. 3-е издание"],
    ["Чистая архитектура", "Чистая архитектура, 2-е изд., перераб. и доп."],
    ["Чистая архитектура", "Чистая архитектура. Второе издание"],
    ["Чиста архітектура", "Чиста архітектура. 3-тє видання"],
    ["Чиста архітектура", "Чиста архітектура, друге видання"],
  ])("should_group_cyrillic_%s_with_%s", (a, b) => {
    expect(pair(a, b, ["Роберт Мартин"])).toEqual([[1, 2]]);
  });

  it.each([
    ["Clean Architecture 2nd Edition", "Clean Architecture 3rd Edition"],
    ["Clean Architecture, Second Edition", "Clean Architecture 3rd ed."],
    ["Clean Architecture 2e", "Clean Architecture (4th Edition)"],
    ["Чистая архитектура. 2-е издание", "Чистая архитектура. 3-е издание"],
    ["Чистая архитектура. Второе издание", "Чистая архитектура, 3-е изд."],
    ["Чиста архітектура, друге видання", "Чиста архітектура. 3-тє видання"],
  ])("should_not_group_different_editions_%s_and_%s", (a, b) => {
    expect(pair(a, b)).toEqual([]);
  });

  it("should_group_the_same_edition_across_spellings", () => {
    const books = [
      book({ id: 1, title: "Clean Architecture 2nd Edition", authors: ["A"] }),
      book({ id: 2, title: "Clean Architecture, Second Edition", authors: ["A"] }),
      book({ id: 3, title: "Clean Architecture 2e", authors: ["A"] }),
    ];
    expect(ids(books)).toEqual([[1, 2, 3]]);
  });

  it.each([
    ["Python 3", "Python 2"],
    ["Web 2.0", "Web 3.0"],
    ["C++20", "C++17"],
    ["Excel 2019", "Excel 2016"],
  ])("should_keep_title_digits_so_%s_and_%s_differ", (a, b) => {
    expect(pair(a, b)).toEqual([]);
  });

  it("should_not_let_edition_parsing_eat_the_version_in_python_3", () => {
    expect(pair("Python 3 Object-Oriented Programming", "Python 3 Object-Oriented Programming 3rd Edition")).toEqual([
      [1, 2],
    ]);
  });

  it("should_not_group_python_3_with_python_2_when_both_carry_the_same_edition", () => {
    expect(pair("Python 3 Programming, 2nd Edition", "Python 2 Programming, 2nd Edition")).toEqual([]);
  });

  it("should_keep_a_title_that_is_only_a_year", () => {
    expect(pair("1984", "1984", ["George Orwell"])).toEqual([[1, 2]]);
  });

  it("should_not_group_a_year_only_title_with_a_different_year", () => {
    expect(pair("1984", "1985", ["George Orwell"])).toEqual([]);
  });

  it("should_group_close_pubdates_and_ignore_the_undefined_date_sentinel", () => {
    const books = [
      book({ id: 1, title: "Refactoring", authors: ["Martin Fowler"], pubdate: "2020-03-01T00:00:00+00:00" }),
      book({ id: 2, title: "Refactoring", authors: ["Martin Fowler"], pubdate: "2021-01-01T00:00:00+00:00" }),
      book({ id: 3, title: "Refactoring", authors: ["Martin Fowler"], pubdate: "0101-01-01T00:00:00+00:00" }),
    ];
    expect(ids(books)).toEqual([[1, 2, 3]]);
  });

  it("should_split_same_title_books_whose_pubdates_are_two_or_more_years_apart", () => {
    const books = [
      book({ id: 1, title: "Refactoring", authors: ["Martin Fowler"], pubdate: "1999-07-08T00:00:00+00:00" }),
      book({ id: 2, title: "Refactoring", authors: ["Martin Fowler"], pubdate: "2018-11-20T00:00:00+00:00" }),
    ];
    expect(ids(books)).toEqual([]);
  });

  it("should_still_group_a_bare_title_with_a_subtitled_one", () => {
    expect(pair("Clean Code", "Clean Code: A Handbook of Agile Software Craftsmanship")).toEqual([[1, 2]]);
  });

  it("should_never_put_two_different_explicit_editions_in_one_group", () => {
    const books = [
      book({ id: 1, title: "Clean Architecture", authors: ["A"] }),
      book({ id: 2, title: "Clean Architecture 2nd Edition", authors: ["A"] }),
      book({ id: 3, title: "Clean Architecture 3rd Edition", authors: ["A"] }),
    ];
    const both = ids(books).some((g) => g.includes(2) && g.includes(3));
    expect(both).toBe(false);
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
