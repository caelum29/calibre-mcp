// #695: section spans per book, stored for display (not embedded). Spans come from the PDF
// outline, else the EPUB TOC, else the chapter detectors; they share the chunks' character
// coordinates, carry the chunks' matter kind, and a hit's section is the deepest span that
// contains its offset.

import { describe, expect, it } from "vitest";
import { matterKinds, type MatterKind } from "../../../src/domain/structure/matter-kind.js";
import type { EpubToc } from "../../../src/domain/structure/epub-toc.js";
import type { OutlineEntry } from "../../../src/domain/structure/pdf-outline.js";
import { bookSections, sectionPathAt, type SectionSpan } from "../../../src/domain/structure/sections.js";

const prose = (topic: string, n: number) => `The ${topic} section explains one idea in plain words. `.repeat(n);

// A paged PDF text: title page, contents, two parts with nested sections, an index.
const PAGES = [
  "Becoming Reliable\nA Field Guide\n",
  "Contents\nPart I Basics 3\n1 Getting Started 3\n2 Going Further 4\nPart II Practice 5\nIndex 6\n",
  "Part I Basics\n\n1 Getting Started\n" +
    prose("starting", 20) +
    "\n1.1 Installing\n" +
    prose("install", 20) +
    "\n1.1.1 Prerequisites\n" +
    prose("prerequisite", 10) +
    "\n1.1.1.1 Too Deep\n" +
    prose("deep", 5),
  "2 Going Further\n" + prose("further", 40),
  "Part II Practice\n3 Testing\n" + prose("testing", 40),
  "Index\nabstraction, 12\nagents, 101-105\nbatching, 77\n",
];
const PDF = PAGES.join("\f");
const pageStart = (p: number) => PAGES.slice(0, p - 1).reduce((n, s) => n + s.length + 1, 0);
const at = (line: string, page: number) => PDF.indexOf(`${line}\n`, pageStart(page));

const OUTLINE: OutlineEntry[] = [
  { title: "Becoming Reliable", page: 1, level: 1 },
  { title: "Contents", page: 2, level: 1 },
  { title: "Part I Basics", page: 3, level: 1 },
  { title: "1 Getting Started", page: 3, level: 2 },
  { title: "1.1   Installing", page: 3, level: 3 },
  { title: "1.1.1 Prerequisites", page: 3, level: 4 },
  { title: "1.1.1.1 Too Deep", page: 3, level: 5 },
  { title: "2 Going Further", page: 4, level: 2 },
  { title: "Part II Practice", page: 5, level: 1 },
  { title: "3 Testing", page: 5, level: 2 },
  { title: "Index", page: 6, level: 1 },
];

// One chunk per page, with the kinds a full index would store for this layout.
const PAGE_CHUNKS = PAGES.map((_, i) => ({ charStart: pageStart(i + 1), charEnd: pageStart(i + 2) - 1 }));
const PAGE_KINDS: MatterKind[] = ["front", "front", "body", "body", "body", "back_index"];

const brief = (s: SectionSpan) => [s.title, s.level, s.charStart, s.charEnd, s.parent, s.matterKind];

describe("bookSections: PDF outline (#695)", () => {
  const r = bookSections(PDF, { outline: OUTLINE }, PAGE_CHUNKS, PAGE_KINDS);

  it("uses the outline as the source", () => {
    expect(r.source).toBe("pdf-outline");
  });

  it("maps levels 1-4 onto title lines, nests them, and drops level 5", () => {
    const furtherAt = at("2 Going Further", 4);
    const part2At = at("Part II Practice", 5);
    const indexAt = at("Index", 6);
    expect(r.sections.map(brief)).toEqual([
      ["Becoming Reliable", 1, 0, at("Contents", 2), null, "front"],
      ["Contents", 1, at("Contents", 2), at("Part I Basics", 3), null, "front"],
      ["Part I Basics", 1, at("Part I Basics", 3), part2At, null, "body"],
      ["1 Getting Started", 2, at("1 Getting Started", 3), furtherAt, 2, "body"],
      ["1.1 Installing", 3, at("1.1 Installing", 3), furtherAt, 3, "body"],
      ["1.1.1 Prerequisites", 4, at("1.1.1 Prerequisites", 3), furtherAt, 4, "body"],
      ["2 Going Further", 2, furtherAt, part2At, 2, "body"],
      ["Part II Practice", 1, part2At, indexAt, null, "body"],
      ["3 Testing", 2, at("3 Testing", 5), indexAt, 7, "body"],
      ["Index", 1, indexAt, PDF.length, null, "back_index"],
    ]);
  });

  it("drops an entry that points before the previous one", () => {
    const outline: OutlineEntry[] = [
      { title: "1 Getting Started", page: 3, level: 1 },
      { title: "Contents", page: 2, level: 1 },
      { title: "2 Going Further", page: 4, level: 1 },
    ];
    const s = bookSections(PDF, { outline }, PAGE_CHUNKS, PAGE_KINDS);
    expect(s.sections.map((x) => x.title)).toEqual(["1 Getting Started", "2 Going Further"]);
  });

  it("falls back to the chapter detectors when the text has no page breaks", () => {
    const text = `Chapter 1: Roots\n${prose("roots", 30)}\nChapter 2: Leaves\n${prose("leaves", 30)}`;
    const s = bookSections(text, { outline: OUTLINE }, [{ charStart: 0, charEnd: text.length }], ["body"]);
    expect([s.source, s.sections.map((x) => x.title)]).toEqual(["chapters", ["Chapter 1: Roots", "Chapter 2: Leaves"]]);
  });
});

describe("bookSections: EPUB TOC (#695)", () => {
  const PRE = "Preface\n" + prose("preface", 20);
  const CH1 = "\nGetting Started\n" + prose("start", 20) + "\nFirst Steps\n" + prose("steps", 20);
  const CH2 = "\nGoing Further\n" + prose("further", 30);
  const TEXT = PRE + CH1 + CH2;
  const TOC: EpubToc = {
    entries: [
      { title: "Preface", level: 1, href: "pre.xhtml" },
      { title: "Getting Started", level: 1, href: "ch1.xhtml" },
      { title: "First Steps", level: 2, href: "ch1.xhtml", fragment: "steps" },
      { title: "Going Further", level: 1, href: "ch2.xhtml" },
    ],
    anchors: [
      { href: "pre.xhtml", start: 0 },
      { href: "ch1.xhtml", start: PRE.length },
      { href: "ch2.xhtml", start: PRE.length + CH1.length },
    ],
  };
  const chunks = [
    { charStart: 0, charEnd: PRE.length },
    { charStart: PRE.length, charEnd: TEXT.length },
  ];
  const r = bookSections(TEXT, { epubToc: TOC }, chunks, ["front", "body"]);

  it("uses the TOC, snaps a fragment entry to its title line, and nests it", () => {
    const steps = TEXT.indexOf("First Steps\n");
    expect([r.source, r.sections.map(brief)]).toEqual([
      "epub-toc",
      [
        ["Preface", 1, 0, PRE.length, null, "front"],
        ["Getting Started", 1, PRE.length, PRE.length + CH1.length, null, "body"],
        ["First Steps", 2, steps, PRE.length + CH1.length, 1, "body"],
        ["Going Further", 1, PRE.length + CH1.length, TEXT.length, null, "body"],
      ],
    ]);
  });

  it("prefers the PDF outline when both are usable", () => {
    expect(bookSections(PDF, { outline: OUTLINE, epubToc: TOC }, PAGE_CHUNKS, PAGE_KINDS).source).toBe("pdf-outline");
  });
});

describe("bookSections: chapter-detector fallback (#695)", () => {
  const TEXT = `Chapter 1: Roots\n${prose("roots", 30)}\nChapter 2: Leaves\n${prose("leaves", 30)}`;
  const two = TEXT.indexOf("Chapter 2");

  it("gives level-1 spans from the detected chapters", () => {
    const r = bookSections(TEXT, {}, [{ charStart: 0, charEnd: TEXT.length }], ["body"]);
    expect([r.source, r.sections.map(brief)]).toEqual([
      "chapters",
      [
        ["Chapter 1: Roots", 1, 0, two, null, "body"],
        ["Chapter 2: Leaves", 1, two, TEXT.length, null, "body"],
      ],
    ]);
  });

  it("returns no source and no spans for a text without structure", () => {
    const text = prose("flat", 50);
    expect(bookSections(text, {}, [{ charStart: 0, charEnd: text.length }], ["body"])).toEqual({
      source: null,
      sections: [],
    });
  });
});

describe("bookSections: matter kind from the chunk classifier (#695, #605)", () => {
  it("takes the kind that covers most of the span's characters", () => {
    const text = `Chapter 1: Roots\n${prose("roots", 30)}\nChapter 2: Leaves\n${prose("leaves", 30)}`;
    const two = text.indexOf("Chapter 2");
    // Chapter 1: 30 front chars, the rest body. Chapter 2: mostly a back_biblio chunk.
    const chunks = [
      { charStart: 0, charEnd: 30 },
      { charStart: 30, charEnd: two + 10 },
      { charStart: two + 10, charEnd: text.length },
    ];
    const r = bookSections(text, {}, chunks, ["front", "body", "back_biblio"]);
    expect(r.sections.map((s) => s.matterKind)).toEqual(["body", "back_biblio"]);
  });

  it("marks a book-title outline entry ahead of the front matter as front (#625, book 1075 shape)", () => {
    const front = [
      "AI-Powered Search\n",
      "brief contents\nIntroducing search 1\nRanking 40\n",
      "contents\n1 Introducing AI-powered search 1\n2 Ranking 40\n",
      "foreword\n" + prose("foreword", 6),
      "preface\n" + prose("preface", 6),
    ];
    const body = [
      "1 Introducing AI-powered search\n" + prose("introduction", 60),
      "2 Ranking\n" + prose("ranking", 60),
    ];
    const pages = [...front, ...body];
    const text = pages.join("\f");
    const starts = pages.map((_, i) => pages.slice(0, i).reduce((n, s) => n + s.length + 1, 0));
    const outline: OutlineEntry[] = [
      { title: "AI-Powered Search", page: 1, level: 1 },
      { title: "brief contents", page: 2, level: 1 },
      { title: "contents", page: 3, level: 1 },
      { title: "foreword", page: 4, level: 1 },
      { title: "preface", page: 5, level: 1 },
      { title: "1 Introducing AI-powered search", page: 6, level: 1 },
      { title: "2 Ranking", page: 7, level: 1 },
    ];
    // A 200-char chunk grid, classified by the same function a full index runs.
    const chunks = Array.from({ length: Math.ceil(text.length / 200) }, (_, i) => ({
      charStart: i * 200,
      charEnd: Math.min(text.length, (i + 1) * 200),
    }));
    const kinds = matterKinds(text, chunks, { outline });
    const r = bookSections(text, { outline }, chunks, kinds);
    expect(r.sections.map((s) => [s.title, s.charStart, s.matterKind])).toEqual([
      ["AI-Powered Search", 0, "front"],
      ["brief contents", starts[1], "front"],
      ["contents", starts[2], "front"],
      ["foreword", starts[3], "front"],
      ["preface", starts[4], "front"],
      ["1 Introducing AI-powered search", starts[5], "body"],
      ["2 Ranking", starts[6], "body"],
    ]);
  });
});

describe("sectionPathAt (#695)", () => {
  const { sections } = bookSections(PDF, { outline: OUTLINE }, PAGE_CHUNKS, PAGE_KINDS);
  const path = (offset: number) => sectionPathAt(sections, offset).map((s) => s.title);

  it("returns the chain from the top level to the deepest span holding the offset", () => {
    expect(path(at("1.1.1 Prerequisites", 3) + 40)).toEqual([
      "Part I Basics",
      "1 Getting Started",
      "1.1 Installing",
      "1.1.1 Prerequisites",
    ]);
  });

  it("puts an offset at a section start in that section, not the one before", () => {
    expect(path(at("2 Going Further", 4))).toEqual(["Part I Basics", "2 Going Further"]);
  });

  it("labels front matter rows too", () => {
    expect(path(0)).toEqual(["Becoming Reliable"]);
  });

  it("returns [] outside every span (text end, negative offset)", () => {
    expect([path(PDF.length), path(-1)]).toEqual([[], []]);
  });
});
