import { describe, expect, it } from "vitest";
import type { Book } from "../../../src/domain/book.js";
import { runQualityChecks } from "../../../src/domain/curation/quality.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "Good Title", authors: ["Real Author"], authorSort: "Author, Real",
    identifiers: { isbn: "9780306406157" }, formats: ["pdf"], tags: ["t"], languages: ["en"],
    publisher: "P", pubdate: "2020-01-01", ...over };
}

const checksOf = (books: Book[]) => runQualityChecks(books).map((i) => i.check);

describe("runQualityChecks", () => {
  it("flags nothing on a fully-populated book", () => {
    expect(runQualityChecks([book()])).toEqual([]);
  });

  it("aggregates missing metadata into one issue", () => {
    const issues = runQualityChecks([book({ authors: ["Unknown"], publisher: undefined, tags: [], identifiers: {}, pubdate: undefined })]);
    const missing = issues.filter((i) => i.check === "missing_metadata");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toMatch(/authors/);
    expect(missing[0]!.message).toMatch(/identifiers/);
  });

  it("flags a raw-filename title (digits, ASIN, extension)", () => {
    expect(checksOf([book({ title: "795731065", identifiers: { isbn: "9780306406157" } })])).toContain("raw_filename_title");
    expect(checksOf([book({ title: "B0CZS7H23N" })])).toContain("raw_filename_title");
    expect(checksOf([book({ title: "top.dvi" })])).toContain("raw_filename_title");
  });

  it("flags an invalid ISBN but not a valid one", () => {
    expect(checksOf([book({ identifiers: { isbn: "9780306406158" } })])).toContain("isbn_invalid");
    expect(checksOf([book({ identifiers: { isbn: "9780306406157" } })])).not.toContain("isbn_invalid");
  });

  it("flags an author_sort mismatch", () => {
    expect(checksOf([book({ authorSort: "Wrong, Name" })])).toContain("author_sort_mismatch");
    expect(checksOf([book({ authorSort: "Author, Real" })])).not.toContain("author_sort_mismatch");
  });

  it("flags series gaps (missing + duplicate indices)", () => {
    const series = [
      book({ id: 1, series: "S", seriesIndex: 1 }),
      book({ id: 2, series: "S", seriesIndex: 3 }),
    ];
    const issues = runQualityChecks(series, ["series_gaps"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/missing index 2/);
  });

  it("honors the checks filter", () => {
    const issues = runQualityChecks([book({ title: "12345", identifiers: {} })], ["raw_filename_title"]);
    expect(issues.every((i) => i.check === "raw_filename_title")).toBe(true);
  });
});
