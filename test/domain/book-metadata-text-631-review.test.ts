// #715 review round 1: the metadata text is built once per book by the version-5 re-index, so
// its cleaning must be right before that pass — normalised like book text, no lone surrogate at
// the cut, no script/style bodies, and the common named entities decoded.

import { describe, expect, it } from "vitest";
import { BLURB_MAX_CHARS, bookMetadataText } from "../../src/domain/book-metadata-text.js";

const base = { title: "T", authors: [], series: undefined, tags: [] };

describe("bookMetadataText cleaning (#631 review)", () => {
  it("runs the character normalisation over the whole text: ligatures fold, soft hyphens go", () => {
    const r = bookMetadataText({ ...base, title: "Eﬃcient Code", comments: "<p>so­ft skills</p>" });
    expect(r.text).toBe("Efficient Code\n\nsoft skills");
    expect(r.blurbChars).toBe("soft skills".length);
  });

  it("never ends the blurb on a lone high surrogate", () => {
    const r = bookMetadataText({ ...base, comments: "a" + "\u{1F600}".repeat(1000) });
    const blurb = r.text.slice(r.text.indexOf("\n\n") + 2);
    expect(blurb.length).toBeLessThanOrEqual(BLURB_MAX_CHARS);
    expect(blurb).not.toMatch(/[\ud800-\udbff]$/);
  });

  it("drops script and style bodies, and a block tag leaves a separator", () => {
    const r = bookMetadataText({
      ...base,
      comments: "<script>alert(1)</script><style>p{color:red}</style><div>bold</div>",
    });
    expect(r.text).toBe("T\n\nbold");
    const sep = bookMetadataText({ ...base, comments: "one<div>two</div>three" });
    expect(sep.text).toBe("T\n\none\ntwo\nthree");
  });

  it.each([
    ["fast&mdash;slow", "fast—slow"],
    ["1&ndash;2", "1–2"],
    ["wait&hellip;", "wait..."], // NFKC folds the ellipsis to three dots, like book text
    ["&lsquo;a&rsquo; &ldquo;b&rdquo;", "‘a’ “b”"],
    ["&laquo;c&raquo;", "«c»"],
    ["&copy; X&trade;", "© XTM"], // NFKC folds ™ to TM
    ["a&nbsp;b", "a b"],
  ])("decodes the named entity in %j", (html, plain) => {
    expect(bookMetadataText({ ...base, comments: html }).text).toBe(`T\n\n${plain}`);
  });
});
