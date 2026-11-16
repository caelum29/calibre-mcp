// #625: a leading title entry before named front matter must not stop the outline picker's
// leading-front-matter drop. The book-1075 outline is the real `pdftohtml -xml` read of
// *AI-Powered Search* (Programming_Books), copied verbatim into the fixture.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chapterNumber } from "../../../src/domain/structure/chapters.js";
import { type EpubToc, epubTocChapters } from "../../../src/domain/structure/epub-toc.js";
import { frontMatterEnd } from "../../../src/domain/structure/front-matter.js";
import { type OutlineEntry, selectChapterEntries } from "../../../src/domain/structure/pdf-outline.js";

const BOOK_1075: OutlineEntry[] = JSON.parse(
  readFileSync(new URL("./fixtures/book-1075-outline.json", import.meta.url), "utf8"),
) as OutlineEntry[];
const BOOK_1075_PAGES = 520;

const e = (title: string, page: number | null = 1, level = 1): OutlineEntry => ({ title, page, level });
const titles = (es: OutlineEntry[] | null) => es?.map((x) => x.title) ?? null;

describe("#625 book-1075 outline (title entry + named front matter as level-1 siblings)", () => {
  it("selectChapterEntries starts at chapter 1, not at the title entry", () => {
    expect(titles(selectChapterEntries(BOOK_1075, BOOK_1075_PAGES))).toEqual([
      "1 Introducing AI-powered search",
      "2 Working with natural language",
      "3 Ranking and content-based relevance",
      "4 Crowdsourced relevance",
      "5 Knowledge graph learning",
      "6 Using context to learn domain-specific language",
      "7 Interpreting query intent through semantic search",
      "8 Signals-boosting models",
      "9 Personalized search",
      "10 Learning to rank for generalizable search relevance",
      "11 Automating learning to rank with click models",
      "12 Overcoming ranking bias through active learning",
      "13 Semantic search with dense vectors",
      "14 Question answering with a fine-tuned large language model",
      "15 Foundation models and emerging search paradigms",
      "appendix A Running the code examples",
      "appendix B Supported search engines and vector databases",
      "index",
      "AI-Powered Search - back",
    ]);
  });

  it("frontMatterEnd over a paged text returns chapter 1's page start", () => {
    // 520 pages of filler; no line matches a title, so every chapter starts at its page start.
    const pages = Array.from({ length: BOOK_1075_PAGES }, (_, i) => `page ${i + 1} filler line\n`.repeat(60));
    const text = pages.join("\f");
    const pageStart = (p: number) => pages.slice(0, p - 1).reduce((n, s) => n + s.length + 1, 0);
    expect(pageStart(34)).toBe(39_093); // under the 60,000-char cap
    expect(frontMatterEnd(text, { outline: BOOK_1075 })).toBe(pageStart(34));
  });

  it("the issue's flat shape (all level 1, no part wrapper) also starts at chapter 1", () => {
    const flat = [
      "AI-Powered Search",
      "brief contents",
      "contents",
      "foreword",
      "preface",
      "acknowledgments",
      "about this book",
      "about the authors",
      "about the cover illustration",
      "1 Introducing AI-powered search",
      "2 Working with natural language",
      "3 Ranking and content-based relevance",
      "4 Crowdsourced relevance",
    ].map((t, i) => e(t, i + 1));
    expect(titles(selectChapterEntries(flat, 100))).toEqual([
      "1 Introducing AI-powered search",
      "2 Working with natural language",
      "3 Ranking and content-based relevance",
      "4 Crowdsourced relevance",
    ]);
  });

  it("the tolerance also applies after a wrapper descent", () => {
    const es = [
      e("Book", 1, 1),
      e("Series Title", 1, 2),
      e("Copyright", 2, 2),
      e("Contents", 3, 2),
      ...["One", "Two", "Three", "Four"].map((t, i) => e(t, 5 + i, 2)),
    ];
    expect(titles(selectChapterEntries(es, 30))).toEqual(["One", "Two", "Three", "Four"]);
  });
});

describe("#625 guards: shapes that keep their current chapter list", () => {
  const chapters = ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"];

  it("a leading non-front-matter entry followed by another one stays", () => {
    const es = ["Introduction", ...chapters].map((t, i) => e(t, i + 1));
    expect(titles(selectChapterEntries(es, 50))).toEqual(["Introduction", ...chapters]);
  });

  it("two leading non-front-matter entries before a front-matter one stay", () => {
    const es = ["Book Title", "Subtitle", "Contents", ...chapters].map((t, i) => e(t, i + 1));
    expect(titles(selectChapterEntries(es, 50))).toEqual(["Book Title", "Subtitle", "Contents", ...chapters]);
  });

  it("a leading part title is never tolerated", () => {
    for (const part of ["Part I", "Часть 1", "Частина 1"]) {
      const es = [part, "Contents", ...chapters].map((t, i) => e(t, i + 1));
      expect(titles(selectChapterEntries(es, 50)), part).toEqual([part, "Contents", ...chapters]);
    }
  });

  it("the single book-title root still descends", () => {
    const es = [
      e("Book Title", 1, 1),
      e("Copyright", 2, 2),
      e("Contents", 3, 2),
      ...chapters.map((t, i) => e(t, 4 + i, 2)),
    ];
    expect(titles(selectChapterEntries(es, 50))).toEqual(chapters);
  });

  it("an outline that starts at chapter 1 is unchanged", () => {
    const es = chapters.map((t, i) => e(t, i + 1));
    expect(titles(selectChapterEntries(es, 50))).toEqual(chapters);
  });
});

describe("#625 EPUB TOC with a book-title entry", () => {
  it("epubTocChapters starts at chapter 1", () => {
    const names = [
      "AI-Powered Search",
      "Copyright",
      "Contents",
      "Chapter 1. Alpha",
      "Chapter 2. Beta",
      "Chapter 3. Gamma",
      "Chapter 4. Delta",
    ];
    const docs = names.map((t) => `# ${t}\n\n${"Body text for this section. ".repeat(20)}\n\n`);
    const text = docs.join("");
    const entries = names.map((title, i) => ({ title, level: 1, href: `d${i}.xhtml` }));
    const anchors = entries.map((x, i) => ({ href: x.href, start: text.indexOf(docs[i]!) }));
    const toc: EpubToc = { entries, anchors };
    expect(epubTocChapters(text, toc, (t) => chapterNumber(t) !== null)?.map((c) => c.heading)).toEqual([
      "Chapter 1. Alpha",
      "Chapter 2. Beta",
      "Chapter 3. Gamma",
      "Chapter 4. Delta",
    ]);
  });
});
