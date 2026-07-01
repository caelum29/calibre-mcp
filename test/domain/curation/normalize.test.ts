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
