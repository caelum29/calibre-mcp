import { describe, expect, it } from "vitest";
import type { Book } from "../../../src/domain/book.js";
import { buildProposal, pickBestHit } from "../../../src/domain/enrich/proposal.js";
import type { ProviderHit } from "../../../src/domain/enrich/types.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

function hit(over: Partial<ProviderHit> = {}): ProviderHit {
  return { source: "openlibrary", confidence: 0.95, ...over };
}

describe("pickBestHit", () => {
  it("returns the highest-confidence hit", () => {
    const best = pickBestHit([hit({ confidence: 0.6, title: "a" }), hit({ confidence: 0.95, title: "b" })]);
    expect(best?.title).toBe("b");
  });
});

describe("buildProposal", () => {
  it("fills a raw-filename title and Unknown authors", () => {
    const current = book({ title: "795731065", authors: ["Unknown"] });
    const p = buildProposal(current, [hit({ title: "Real Title", authors: ["A. Author"] })]);
    expect(p.changes).toMatchObject({ title: "Real Title", authors: ["A. Author"] });
    const titleField = p.fields.find((f) => f.field === "title")!;
    expect(titleField.reason).toBe("weak"); // raw filename present → weak, not missing
  });

  it("does NOT clobber a good existing title or authors", () => {
    const current = book({ title: "A Perfectly Good Title", authors: ["Jane Doe"], publisher: "Acme" });
    const p = buildProposal(current, [hit({ title: "Different", authors: ["Someone Else"], publisher: "Other" })]);
    expect(p.changes).not.toHaveProperty("title");
    expect(p.changes).not.toHaveProperty("authors");
    expect(p.changes).not.toHaveProperty("publisher"); // already present → untouched
  });

  it("adds a missing isbn as an identifiers object but never overwrites one", () => {
    const missing = buildProposal(book({ title: "x" }), [hit({ isbn: "9780306406157" })]);
    expect(missing.changes.identifiers).toEqual({ isbn: "9780306406157" });

    const present = buildProposal(book({ title: "x", identifiers: { isbn: "111" } }), [hit({ isbn: "9780306406157" })]);
    expect(present.changes).not.toHaveProperty("identifiers");
  });

  it("only emits update_book-allowlisted fields", () => {
    const p = buildProposal(book({ title: "12345" }), [
      hit({ title: "T", authors: ["A"], publisher: "P", pubdate: "2020", series: "S", isbn: "9780306406157" }),
    ]);
    const allowed = new Set(["title", "authors", "publisher", "pubdate", "series", "identifiers"]);
    expect(Object.keys(p.changes).every((k) => allowed.has(k))).toBe(true);
  });

  it("returns an empty proposal when there are no hits", () => {
    expect(buildProposal(book(), [])).toEqual({ fields: [], changes: {} });
  });
});
