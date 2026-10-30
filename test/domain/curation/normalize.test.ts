import { describe, expect, it } from "vitest";
import type { Book } from "../../../src/domain/book.js";
import { authorToAuthorSort, identicalKey, similarKey } from "../../../src/domain/curation/normalize.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

describe("identicalKey", () => {
  it("ignores case and whitespace differences", () => {
    const a = book({ title: "The  Rust Book", authors: ["Steve Klabnik"] });
    const b = book({ title: "the rust book", authors: ["steve klabnik"] });
    expect(identicalKey(a)).toBe(identicalKey(b));
  });

  it("is order-independent on authors", () => {
    const a = book({ title: "X", authors: ["A", "B"] });
    const b = book({ title: "X", authors: ["B", "A"] });
    expect(identicalKey(a)).toBe(identicalKey(b));
  });

  it("distinguishes different titles", () => {
    expect(identicalKey(book({ title: "A" }))).not.toBe(identicalKey(book({ title: "B" })));
  });
});

describe("similarKey", () => {
  it("collapses subtitle, article, and accents", () => {
    const a = book({ title: "The Rust Programming Language", authors: ["Café Author"] });
    const b = book({ title: "Rust Programming Language: 2nd Edition", authors: ["Cafe Author"] });
    expect(similarKey(a)).toBe(similarKey(b));
  });

  it("drops a parenthetical subtitle", () => {
    const a = book({ title: "Dune" });
    const b = book({ title: "Dune (Special Edition)" });
    expect(similarKey(a)).toBe(similarKey(b));
  });
});

// #241: similar keys must keep non-Latin letters instead of collapsing them to "".
describe("similarKey non-Latin scripts (#241)", () => {
  const key = (title: string, authors: string[] = []) => similarKey(book({ title, authors }));

  it("should_distinguish_different_cyrillic_titles_by_the_same_cyrillic_author", () => {
    expect(key("Врата Европы. История Украины", ["Сергей Плохий"])).not.toBe(
      key("Искусственный интеллект для чайников", ["Сергей Плохий"]),
    );
  });

  it("should_distinguish_different_cyrillic_authors_on_the_same_title", () => {
    expect(key("Алгоритмы", ["Иванов"])).not.toBe(key("Алгоритмы", ["Петров"]));
  });

  it("should_match_the_same_cyrillic_title_across_case_and_punctuation", () => {
    expect(key("Вы не знаете JS Замыкания и объекты", ["Kyle Simpson"])).toBe(
      key("вы не знаете JS. Замыкания, и объекты!", ["Kyle Simpson"]),
    );
  });

  it("should_distinguish_mixed_script_titles_that_share_only_the_latin_word", () => {
    expect(key("Python для начинающих")).not.toBe(key("Python для профессионалов"));
  });

  it("should_fold_yo_to_ye", () => {
    expect(key("Ёжик в тумане", ["Юрий Норштейн"])).toBe(key("Ежик в тумане", ["Юрий Норштейн"]));
  });

  it("should_still_distinguish_titles_after_yo_folding", () => {
    expect(key("Ёжик в тумане")).not.toBe(key("Ежик в лесу"));
  });

  it("should_keep_ukrainian_letters_distinct", () => {
    const keys = new Set([key("Ґрунти"), key("Їжаки"), key("Єнот"), key("Іриси")]);
    expect(keys.size).toBe(4);
  });

  it("should_treat_cyrillic_short_i_and_yi_as_letters_not_accents", () => {
    expect(key("Мой путь")).not.toBe(key("Мои путь"));
  });

  it("should_match_nfc_and_nfd_spellings_of_a_cyrillic_title", () => {
    expect(key("Країна мрій".normalize("NFC"))).toBe(key("Країна мрій".normalize("NFD")));
  });

  it("should_match_nfc_and_nfd_spellings_of_a_latin_title", () => {
    expect(key("Café Society".normalize("NFD"))).toBe(key("Café Society".normalize("NFC")));
  });

  it("should_distinguish_different_cjk_titles", () => {
    expect(key("深度学习")).not.toBe(key("机器学习"));
  });

  it("should_drop_a_fullwidth_colon_subtitle_on_a_cjk_title", () => {
    expect(key("深度学习：入门")).toBe(key("深度学习"));
  });

  it("should_keep_japanese_voicing_marks", () => {
    expect(key("がくしゅう")).not.toBe(key("かくしゅう"));
  });
});

describe("authorToAuthorSort", () => {
  it("flips First Last to Last, First", () => {
    expect(authorToAuthorSort("Steve Klabnik")).toBe("Klabnik, Steve");
  });

  it("returns a name that already has a comma unchanged", () => {
    expect(authorToAuthorSort("Klabnik, Steve")).toBe("Klabnik, Steve");
  });

  it("returns a single token unchanged", () => {
    expect(authorToAuthorSort("Aristotle")).toBe("Aristotle");
  });

  it("keeps a trailing suffix after the surname", () => {
    expect(authorToAuthorSort("Ralph Johnson Jr")).toBe("Johnson, Ralph Jr");
  });

  it("handles multi-word given names", () => {
    expect(authorToAuthorSort("John Ronald Reuel Tolkien")).toBe("Tolkien, John Ronald Reuel");
  });
});
