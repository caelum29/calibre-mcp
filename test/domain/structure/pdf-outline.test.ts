import { describe, it, expect } from "vitest";
import {
  isFrontMatterTitle,
  outlineChapters,
  type OutlineEntry,
  parsePdfOutlineXml,
  selectChapterEntries,
} from "../../../src/domain/structure/pdf-outline.js";
import { detectChapters } from "../../../src/domain/structure/chapters.js";
import { frontMatterEnd } from "../../../src/domain/structure/front-matter.js";

// Shapes below mirror real `pdftohtml -q -i -xml -stdout -f 1 -l 1` output (poppler 26.07).
const xmlDoc = (outline: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE pdf2xml SYSTEM "pdf2xml.dtd">\n<pdf2xml producer="poppler" version="26.07.0">\n${outline}\n<page number="1"><text top="1" left="1" width="1" height="1" font="0">Cover &lt;outline&gt; text</text></page>\n</pdf2xml>`;

const EN_XML = xmlDoc(`<outline>
<item page="1">Title Page</item>
<item page="2">Copyright and Credits</item>
<item page="3">Table of Contents</item>
<item page="5">Chapter 1: Understanding the Kill Chain</item>
<outline>
<item page="5">The evolving landscape</item>
<item page="6">Summary</item>
</outline>
<item page="7">Chapter 2: Reconnaissance &amp; Recon</item>
<outline>
<item page="7">Passive Recon</item>
<outline>
<item page="8">Tools</item>
</outline>
</outline>
<item page="9">Chapter 3: Delivery</item>
<item page="10">Index</item>
</outline>`);

/** Pages joined like pdftotext output: each page ends "\n\f". */
const pages = (...ps: string[]) => ps.join("\n\f");

describe("parsePdfOutlineXml", () => {
  it("parses nested items into level-tagged, document-order entries", () => {
    const es = parsePdfOutlineXml(EN_XML);
    expect(es.map((e) => [e.level, e.page, e.title])).toEqual([
      [1, 1, "Title Page"],
      [1, 2, "Copyright and Credits"],
      [1, 3, "Table of Contents"],
      [1, 5, "Chapter 1: Understanding the Kill Chain"],
      [2, 5, "The evolving landscape"],
      [2, 6, "Summary"],
      [1, 7, "Chapter 2: Reconnaissance & Recon"],
      [2, 7, "Passive Recon"],
      [3, 8, "Tools"],
      [1, 9, "Chapter 3: Delivery"],
      [1, 10, "Index"],
    ]);
  });

  it("returns [] for a PDF without an outline (page text only)", () => {
    expect(parsePdfOutlineXml(xmlDoc(""))).toEqual([]);
  });

  it("returns [] for empty or non-XML input", () => {
    expect(parsePdfOutlineXml("")).toEqual([]);
    expect(parsePdfOutlineXml("Syntax Error: Couldn't read xref table")).toEqual([]);
  });

  it("keeps what it can read from truncated XML", () => {
    const es = parsePdfOutlineXml(`<outline>\n<item page="3">Intro</item>\n<item page="9">Chap`);
    expect(es).toEqual([{ title: "Intro", page: 3, level: 1 }]);
  });

  it("records a null page for items whose destination did not resolve", () => {
    expect(parsePdfOutlineXml(`<outline><item>Title Page</item></outline>`)).toEqual([
      { title: "Title Page", page: null, level: 1 },
    ]);
  });

  it("decodes entities, strips inline tags and collapses whitespace (Cyrillic intact)", () => {
    const es = parsePdfOutlineXml(
      `<outline><item page="4"><b>Глава&#160;1.</b>\n  Об&#x430;сти &quot;видимости&quot;</item></outline>`,
    );
    expect(es[0]!.title).toBe('Глава 1. Обaсти "видимости"'.replace("a", "а"));
  });

  it("ignores items outside any <outline> element", () => {
    expect(parsePdfOutlineXml(`<item page="1">stray</item>`)).toEqual([]);
  });

  it("tolerates a self-closing empty <outline/> and unbalanced closers", () => {
    const es = parsePdfOutlineXml(`</outline><outline><outline/><item page="2">A</item></outline>`);
    expect(es).toEqual([{ title: "A", page: 2, level: 1 }]);
  });
});

describe("isFrontMatterTitle", () => {
  it("recognizes EN and RU front matter", () => {
    for (const t of [
      "Cover",
      "Copyright and Credits",
      "Table of Contents",
      "Preface",
      "Preface: Invalidating Axioms",
      "About the Authors",
      "Об авторе",
      "О научном редакторе русского издания",
      "Отзывы о книге «X»",
      "Предисловие",
    ]) {
      expect(isFrontMatterTitle(t), t).toBe(true);
    }
  });

  it("does not treat chapters or Introduction as front matter", () => {
    for (const t of ["Chapter 1: Preface to Rust", "Introduction", "Введение", "Глава 1. Что такое антипаттерн?"]) {
      expect(isFrontMatterTitle(t), t).toBe(false);
    }
  });
});

const e = (title: string, page: number | null, level = 1): OutlineEntry => ({ title, page, level });

describe("selectChapterEntries", () => {
  it("uses top-level entries minus leading front matter", () => {
    const picked = selectChapterEntries(parsePdfOutlineXml(EN_XML), 10);
    expect(picked?.map((x) => x.title)).toEqual([
      "Chapter 1: Understanding the Kill Chain",
      "Chapter 2: Reconnaissance & Recon",
      "Chapter 3: Delivery",
      "Index",
    ]);
  });

  it("descends through a single book-title root", () => {
    const es = [e("My Book", 1), e("One", 2, 2), e("Two", 5, 2), e("Three", 8, 2), e("Four", 11, 2)];
    expect(selectChapterEntries(es, 20)?.map((x) => x.title)).toEqual(["One", "Two", "Three", "Four"]);
  });

  it("expands Part entries mixed with chapters at the top level (RU Часть)", () => {
    const es = [
      e("Введение", 3),
      e("Часть 1. Основы", 5),
      e("Глава 1. A", 6, 2),
      e("Глава 2. B", 9, 2),
      e("Часть 2. Практика", 12),
      e("Глава 3. C", 13, 2),
      e("Глава 4. D", 16, 2),
      e("Предметный указатель", 20),
    ];
    expect(selectChapterEntries(es, 30)?.map((x) => x.title)).toEqual([
      "Введение",
      "Глава 1. A",
      "Глава 2. B",
      "Глава 3. C",
      "Глава 4. D",
      "Предметный указатель",
    ]);
  });

  it("descends a thin top level of unlabeled parts", () => {
    const es = [
      e("Setup", 2),
      e("Install", 3, 2),
      e("Configure", 6, 2),
      e("Fundamentals", 9),
      e("Types", 10, 2),
      e("Loops", 13, 2),
    ];
    expect(selectChapterEntries(es, 20)?.map((x) => x.title)).toEqual(["Install", "Configure", "Types", "Loops"]);
  });

  it("rejects a flat one-bookmark-per-page outline", () => {
    const es = Array.from({ length: 100 }, (_, i) => e(String(i).padStart(3, "0"), i + 1));
    expect(selectChapterEntries(es, 100)).toBeNull();
  });

  it("rejects more than 150 entries even in a long book", () => {
    const es = Array.from({ length: 151 }, (_, i) => e(`Section ${i}`, i * 4 + 1));
    expect(selectChapterEntries(es, 1000)).toBeNull();
  });

  it("rejects an outline with fewer than two page-bearing entries", () => {
    expect(selectChapterEntries([e("Cover", 1), e("Title Page", null), e("Copyright", null)], 300)).toBeNull();
    expect(selectChapterEntries([], 300)).toBeNull();
  });
});

describe("outlineChapters (page → offset)", () => {
  const text = pages(
    "Cover art",
    "Copyright 2026",
    "Contents\nChapter 1 ... 5",
    "blank",
    "Running header\nChapter 1\nUnderstanding the Kill Chain\nBody one.",
    "more body",
    "CHAPTER 2\nReconnaissance & Recon\nBody two.",
    "body",
    "Chapter 3: Delivery\nBody three.",
    "Index\nalpha, 3",
  );

  it("maps outline pages to \\f page starts and snaps to the heading line", () => {
    const ch = outlineChapters(text, parsePdfOutlineXml(EN_XML))!;
    expect(ch.map((c) => c.n)).toEqual([1, 2, 3, 4]);
    expect(ch[0]!.startChar).toBe(text.indexOf("Chapter 1\nUnderstanding")); // snapped past the running header
    expect(ch[1]!.startChar).toBe(text.indexOf("CHAPTER 2")); // case/punctuation-insensitive
    expect(ch[3]!.startChar).toBe(text.indexOf("Index\nalpha"));
  });

  it("chains spans end-to-start and ends the last at the text end", () => {
    const ch = outlineChapters(text, parsePdfOutlineXml(EN_XML))!;
    expect(ch[0]!.endChar).toBe(ch[1]!.startChar);
    expect(ch[3]!.endChar).toBe(text.length);
  });

  it("falls back to the page start when the title is not on the page", () => {
    const t = pages("p1", "unrelated words here", "other stuff");
    const ch = outlineChapters(t, [e("Alpha", 2), e("Beta", 3)])!;
    expect(ch.map((c) => c.startChar)).toEqual([t.indexOf("unrelated"), t.indexOf("other")]);
  });

  it("drops bookmarks past the last page and same-page duplicates", () => {
    const t = pages("p1", "Alpha", "Beta", "Gamma", ...Array.from({ length: 10 }, () => "filler"));
    const ch = outlineChapters(t, [e("Alpha", 2), e("Alpha again", 2), e("Beta", 3), e("Gamma", 4), e("Ghost", 99)])!;
    expect(ch.map((c) => c.heading)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("returns null when the text has no page breaks to map onto", () => {
    expect(outlineChapters("one long blob without form feeds", [e("A", 1), e("B", 2)])).toBeNull();
  });
});

describe("detectChapters precedence", () => {
  const body = (w: string) => `${w} `.repeat(400);
  const text = pages(
    "Cover",
    `Getting Started\n${body("aaa")}`,
    `Going Further\n${body("bbb")}`,
    `Chapter 7\n${body("ccc")}`,
  );

  it("prefers a usable outline over text headings (detector pdf-outline)", () => {
    const r = detectChapters(text, { outline: [e("Getting Started", 2), e("Going Further", 3)] });
    expect(r.detector).toBe("pdf-outline");
  });

  it("falls back to the text detectors when the outline is unusable", () => {
    const r = detectChapters(text, { outline: [e("Cover", 1)] });
    expect(r.detector).toBe("numeric");
  });

  it("falls back to the text detectors without an outline", () => {
    expect(detectChapters(text).detector).toBe("numeric");
  });

  it("frontMatterEnd uses the outline's first body chapter", () => {
    expect(frontMatterEnd(text, { outline: [e("Cover", 1), e("Getting Started", 2), e("Going Further", 3)] })).toBe(
      text.indexOf("Getting Started"),
    );
  });
});
