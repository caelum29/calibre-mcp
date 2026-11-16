// #625 review: the book-title tolerance must never drop a chapter-like lead entry, on the PDF
// outline path and the EPUB TOC path alike; and no second front-matter title list may appear.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chapterNumber } from "../../../src/domain/structure/chapters.js";
import { type EpubToc, epubTocChapters } from "../../../src/domain/structure/epub-toc.js";
import { selectChapterEntries } from "../../../src/domain/structure/pdf-outline.js";

// Each shape: a chapter-like lead entry, then a front-matter name, then body chapters. The
// lead entry must stay, so the whole list comes back unchanged.
const SHAPES: Record<string, string[]> = {
  "numbered 1 Introduction + Acknowledgments": ["1 Introduction", "Acknowledgments", "2 Basics", "3 Tools", "4 Next"],
  "Chapter 1 + Preface": ["Chapter 1", "Preface", "Chapter 2", "Chapter 3", "Chapter 4"],
  "Introduction + Acknowledgments": ["Introduction", "Acknowledgments", "Chapter 1", "Chapter 2", "Chapter 3"],
  "Глава 1 + Предисловие": ["Глава 1", "Предисловие", "Глава 2", "Глава 3", "Глава 4"],
  "Prologue + Contents": ["Prologue", "Contents", "Chapter 1", "Chapter 2", "Chapter 3"],
  "Getting Started + Preface": ["Getting Started", "Preface", "Chapter 1", "Chapter 2", "Chapter 3"],
  "roman I. + Foreword": ["I. Foundations", "Foreword", "II. Methods", "III. Practice", "IV. Outlook"],
  "Вступ + Передмова": ["Вступ", "Передмова", "Розділ 1", "Розділ 2", "Розділ 3"],
};

function epubHeadings(names: string[]): string[] | null {
  const docs = names.map((t) => `# ${t}\n\n${"Body text for this section. ".repeat(20)}\n\n`);
  const text = docs.join("");
  const entries = names.map((title, i) => ({ title, level: 1, href: `d${i}.xhtml` }));
  const toc: EpubToc = { entries, anchors: entries.map((x, i) => ({ href: x.href, start: text.indexOf(docs[i]!) })) };
  return epubTocChapters(text, toc, (t) => chapterNumber(t) !== null)?.map((c) => c.heading) ?? null;
}

describe("#625 chapter-like lead entries are never tolerated", () => {
  for (const [name, titles] of Object.entries(SHAPES)) {
    it(`PDF outline keeps ${name}`, () => {
      const es = titles.map((title, i) => ({ title, page: i + 1, level: 1 }));
      expect(selectChapterEntries(es, 50)?.map((x) => x.title)).toEqual(titles);
    });

    it(`EPUB TOC keeps ${name}`, () => {
      expect(epubHeadings(titles)).toEqual(titles);
    });
  }

  it("the book-title entry is still dropped on both paths", () => {
    const titles = ["AI-Powered Search", "Copyright", "Contents", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"];
    const es = titles.map((title, i) => ({ title, page: i + 1, level: 1 }));
    expect([selectChapterEntries(es, 50)?.map((x) => x.title), epubHeadings(titles)]).toEqual([
      ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"],
      ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"],
    ]);
  });
});

describe("one front-matter title list under src/domain/structure (distinctive patterns)", () => {
  // Words only a front-matter title list would spell out; comments elsewhere avoid them.
  const LIST_MARKERS = [/acknowledg/i, /colophon/i, /foreword/i, /об автор/i, /благодарност/i, /dedication/i];

  it("no file but front-matter-titles.ts carries list patterns", () => {
    const dir = new URL("../../../src/domain/structure/", import.meta.url);
    const holders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "front-matter-titles.ts")
      .flatMap((f) => {
        const src = readFileSync(new URL(f, dir), "utf8");
        return LIST_MARKERS.filter((m) => m.test(src)).map((m) => `${f}: ${m.source}`);
      });
    expect(holders).toEqual([]);
  });
});
