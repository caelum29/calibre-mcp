// #631 index side: the per-book metadata text ("row-to-text") — title, authors, series, tags and
// the Calibre comments blurb with HTML stripped, the blurb cut to ~1,800 chars at a word boundary.

import { describe, expect, it } from "vitest";
import type { Book } from "../../src/domain/book.js";
import { BLURB_MAX_CHARS, bookMetadataText } from "../../src/domain/book-metadata-text.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 247,
  uuid: "u-247",
  title: "Professional JavaScript for Web Developers",
  authors: ["Matt Frisbie"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: ["eng"],
  ...over,
});

describe("bookMetadataText (#631)", () => {
  it("joins title, authors, series, tags and the HTML-stripped blurb, one field per line", () => {
    const r = bookMetadataText(
      book({
        authors: ["Nicholas C. Zakas", "Matt Frisbie"],
        series: "Wrox Professional Guides",
        seriesIndex: 4,
        tags: ["JavaScript", "Web"],
        comments: "<div><p>Learn <b>JS</b> &amp; the&nbsp;DOM.</p><p>Events &lt;and&gt; APIs&#39;</p></div>",
      }),
    );
    expect(r).toEqual({
      text:
        "Professional JavaScript for Web Developers\n" +
        "Nicholas C. Zakas, Matt Frisbie\n" +
        "Wrox Professional Guides\n" +
        "JavaScript, Web\n" +
        "\n" +
        "Learn JS & the DOM.\n" +
        "Events <and> APIs'",
      blurbChars: "Learn JS & the DOM.\nEvents <and> APIs'".length,
    });
  });

  it("a book with no blurb, series or tags still gets text: title and authors", () => {
    expect(bookMetadataText(book())).toEqual({
      text: "Professional JavaScript for Web Developers\nMatt Frisbie",
      blurbChars: 0,
    });
  });

  it("markup-only or blank comments count as no blurb", () => {
    expect(bookMetadataText(book({ comments: "<div><br/> &nbsp; </div>" }))).toEqual({
      text: "Professional JavaScript for Web Developers\nMatt Frisbie",
      blurbChars: 0,
    });
  });

  it("cuts a long blurb at the last word boundary within the cap", () => {
    expect(BLURB_MAX_CHARS).toBe(1800);
    const r = bookMetadataText(book({ comments: "word ".repeat(500) }));
    const blurb = Array.from({ length: 360 }, () => "word").join(" "); // 1,799 chars
    expect(r).toEqual({
      text: `Professional JavaScript for Web Developers\nMatt Frisbie\n\n${blurb}`,
      blurbChars: 1799,
    });
  });

  it("a blurb with no whitespace before the cap is cut hard at the cap", () => {
    const r = bookMetadataText(book({ comments: "x".repeat(2500) }));
    expect(r.blurbChars).toBe(1800);
  });

  it("collapses runs of spaces and blank lines inside the blurb", () => {
    const r = bookMetadataText(book({ comments: "<p>One   two\t three</p>\n\n\n<p></p><p>Four</p>" }));
    expect(r.text.split("\n\n")[1]).toBe("One two three\nFour");
  });
});
