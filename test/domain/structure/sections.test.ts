// #620 spike: section spans from a PDF outline, the path at an offset, arm-2 cut points, and the
// chunker's per-start budget seam. Front matter (incl. the #625 title-page stub) gets no path.

import { describe, expect, it } from "vitest";
import { bookSections, sectionPathAt, sectionPrefix, sectionStarts } from "../../../src/domain/structure/sections.js";
import { chunkForEmbedding } from "../../../src/semantic/chunk.js";

// Five pages: title page, contents, chapter 1 (with 1.1 on the next page), chapter 2.
const pages = [
  "AI-Powered Search\nTrey Grainger\n",
  "contents\n1 Introducing search .... 3\n",
  "1 Introducing search\nBody of chapter one.\n",
  "1.1 Why search matters\nMore text.\n",
  "2 Working with language\nChapter two body.\n",
];
const text = pages.join("\f");
const starts = pages.map((_, i) => pages.slice(0, i).reduce((n, p) => n + p.length + 1, 0));
const outline = [
  { title: "AI-Powered Search", page: 1, level: 1 },
  { title: "contents", page: 2, level: 1 },
  { title: "1 Introducing search", page: 3, level: 1 },
  { title: "1.1 Why search matters", page: 4, level: 2 },
  { title: "2 Working with language", page: 5, level: 1 },
];

describe("bookSections (pdf outline)", () => {
  const { source, sections } = bookSections(text, { outline });

  it("maps every entry to its page start and nests 1.1 under chapter 1", () => {
    expect(source).toBe("pdf-outline");
    expect(sections.map((s) => [s.title, s.start, s.end, s.parent])).toEqual([
      ["AI-Powered Search", 0, starts[1], null],
      ["contents", starts[1], starts[2], null],
      ["1 Introducing search", starts[2], starts[4], null],
      ["1.1 Why search matters", starts[3], starts[4], 2],
      ["2 Working with language", starts[4], text.length, null],
    ]);
  });

  it("marks the title-page stub and contents as front matter (#625)", () => {
    expect(sections.map((s) => s.frontMatter)).toEqual([true, true, false, false, false]);
  });

  it("gives front matter no path, a chapter its title, a subsection chapter › section", () => {
    expect(sectionPathAt(sections, 5)).toEqual([]);
    expect(sectionPathAt(sections, starts[1]! + 3)).toEqual([]);
    expect(sectionPathAt(sections, starts[2]! + 3)).toEqual(["1 Introducing search"]);
    expect(sectionPathAt(sections, starts[3]! + 3)).toEqual(["1 Introducing search", "1.1 Why search matters"]);
    expect(sectionPathAt(sections, starts[4]!)).toEqual(["2 Working with language"]);
  });

  it("cuts arm 2 at body-section starts only", () => {
    expect(sectionStarts(sections)).toEqual([starts[2], starts[3], starts[4]]);
  });
});

describe("sectionPrefix", () => {
  it("joins title and path and cuts each title to 80 chars; null for an empty path", () => {
    expect(sectionPrefix("Book", ["Ch", "Sec"])).toBe("[Book › Ch › Sec]\n");
    expect(sectionPrefix("Book", [])).toBeNull();
    expect(sectionPrefix("x".repeat(90), ["Ch"])).toBe(`[${"x".repeat(80)} › Ch]\n`);
  });
});

describe("chunkForEmbedding budgetAt", () => {
  it("uses the budget of the section where each chunk starts", () => {
    const t = "a".repeat(10) + "b".repeat(10);
    const chunks = chunkForEmbedding(t, { budgetAt: (s) => (s < 10 ? 10 : 4) });
    expect(chunks.map((c) => [c.charStart, c.charEnd])).toEqual([
      [0, 10],
      [10, 14],
      [14, 18],
      [18, 20],
    ]);
  });
});
