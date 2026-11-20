// #560 / ADR-0033 item 5: the EPUB artefact rule set of the normalisation stage, for ebook-convert
// (Markdown) text only. Samples are from books 929, 146, 624 and 715 of the live library.
import { describe, expect, it } from "vitest";
import { normaliseText, ruleSetsFor } from "../../../src/domain/normalise/normalise.js";
import { toRaw } from "../../../src/domain/normalise/offset-map.js";

const epub = (raw: string) => normaliseText(raw, ruleSetsFor("ebook-convert")).text;

describe("EPUB artefact rules (#560)", () => {
  it("unescapes Markdown punctuation and strips paired emphasis (book 929)", () => {
    expect(epub("Vector \\(i.e., unstructured\\) data")).toBe("Vector (i.e., unstructured) data");
    expect(epub("stored as *BLOBs* \\(binary large objects\\) or directly in files")).toBe(
      "stored as BLOBs (binary large objects) or directly in files",
    );
  });

  it("collapses blank runs and unescapes brackets inside emphasis (book 146)", () => {
    const raw =
      "for unnecessary complexity.\n\n\n\n\n\n*\u201cThe biggest problem is complexity\u201d \\[Out of the tar pit by Ben Moseley & Peter Marks\\].*\n\n\n\n\n\n";
    expect(epub(raw)).toBe(
      "for unnecessary complexity.\n\n\u201cThe biggest problem is complexity\u201d [Out of the tar pit by Ben Moseley & Peter Marks].\n\n",
    );
    expect(epub("A React field guide\n\n\n\n\n\n*By* Addy Osmani\n\n\n\n\n\n \n\n \n\n \n\n\u00a9 Addy")).toBe(
      "A React field guide\n\nBy Addy Osmani\n\n\u00a9 Addy",
    );
  });

  it("makes bold code readable again (book 624)", () => {
    const raw = '**fn main \\( \\) \\{**\n\n**let mut x = vec\\! \\[ "Hello" , "world" \\];**\n\n**\\}**\n\n';
    expect(epub(raw)).toBe('fn main ( ) {\n\nlet mut x = vec! [ "Hello" , "world" ];\n\n}\n\n');
  });

  it("squeezes token-spaced code (book 715)", () => {
    const raw =
      "            perf_micro         =         np    .    zeros    ((    max_k    ,         max_k    ))    \n" +
      "            max_k         =         min    (    len    (    ds_train    ),         max_k    )    \n";
    expect(epub(raw)).toBe(
      "            perf_micro = np.zeros((max_k , max_k ))\n            max_k = min(len(ds_train ), max_k )\n",
    );
  });

  it("strips inline-code backticks at word boundaries", () => {
    expect(epub("call `fetch()` first, then `a`b")).toBe("call fetch() first, then `a`b");
  });

  it("strips trailing spaces on a line", () => {
    expect(epub("hard break  \nnext line\t\nend")).toBe("hard break\nnext line\nend");
  });

  it("changes nothing inside fenced code", () => {
    const raw = "before \\(x\\)\n\n```\nfoo \\( bar *x*   .   y   (   z   \n\n\n\n`q`\n```\nafter *y*";
    expect(epub(raw)).toBe("before (x)\n\n```\nfoo \\( bar *x*   .   y   (   z   \n\n\n\n`q`\n```\nafter y");
  });

  it("leaves an unpaired or arithmetic asterisk and snake_case alone", () => {
    const raw = "a*b, 2 * 3 * 4, a*b*c and snake_case_name";
    expect(epub(raw)).toBe(raw);
  });

  it("keeps heading markers and never turns an escaped # into a heading", () => {
    const raw = "text\n## Chapter \\(1\\)\n\n### Sub\n\\# not a heading\n# Top";
    expect(epub(raw)).toBe("text\n## Chapter (1)\n\n### Sub\n\\# not a heading\n# Top");
  });

  it("leaves a space-aligned table alone", () => {
    const raw = "Name        Age    City\nAlice       30     Paris\nVersion     1.0    2020\n";
    expect(epub(raw)).toBe(raw);
  });

  it("keeps every page break and maps offsets back to the raw text", () => {
    const raw = "page one \\(x\\)   \n\f\n\n\n\n**let mut x = vec\\! \\[1\\];**\f";
    const { text, map } = normaliseText(raw, ruleSetsFor("ebook-convert"));
    expect(text).toBe("page one (x)\n\f\n\nlet mut x = vec! [1];\f");
    expect(text.split("\f").length).toBe(raw.split("\f").length);
    expect(toRaw(map, text.indexOf("let"))).toBe(raw.indexOf("let"));
    expect(toRaw(map, text.indexOf("vec"))).toBe(raw.indexOf("vec"));
    expect(toRaw(map, text.length)).toBe(raw.length);
  });

  it("runs only on ebook-convert Markdown output", () => {
    const raw = "a \\(b\\) *c*\n\n\n\nd";
    expect(normaliseText(raw, ruleSetsFor("pdftotext")).text).toBe(raw);
    expect(normaliseText(raw, ruleSetsFor("ebook-convert:plain")).text).toBe(raw);
    expect(normaliseText(raw, ruleSetsFor("pymupdf")).text).toBe(raw);
    expect(normaliseText(raw, ruleSetsFor("raw")).text).toBe(raw);
  });
});
