import { describe, it, expect } from "vitest";
import { chapterNumber, detectChapters, frontMatterEnd } from "../../../src/domain/structure/chapters.js";

describe("chapterNumber", () => {
  it("accepts explicit Latin chapter headings", () => {
    expect(chapterNumber("Chapter 5")).toBe(5);
    expect(chapterNumber("Chapter 1. Introduction")).toBe(1);
    expect(chapterNumber("Capítulo 3: El principio")).toBe(3);
    expect(chapterNumber("Kapitel 2 Überblick")).toBe(2);
    expect(chapterNumber("ch. 7")).toBe(7);
  });

  it("accepts Cyrillic chapter headings (RU + UK)", () => {
    expect(chapterNumber("Глава 5")).toBe(5);
    expect(chapterNumber("ГЛАВА 14")).toBe(14);
    expect(chapterNumber("Глава 5. Программное управление")).toBe(5);
    expect(chapterNumber("Розділ 3 Вступ")).toBe(3);
    expect(chapterNumber("Часть 2")).toBe(2);
  });

  it("rejects prose cross-references (lowercase continuation)", () => {
    expect(chapterNumber("Chapter 6 explores the topic")).toBeNull();
    expect(chapterNumber("Chapter 8 are relevant here")).toBeNull();
    expect(chapterNumber("Глава 5 рассматривает управление")).toBeNull();
  });

  it("rejects years and out-of-range numbers", () => {
    expect(chapterNumber("Chapter 2025")).toBeNull(); // 4-digit → no match
  });

  it("rejects long lines (prose, not a heading)", () => {
    const long = "Chapter 1 " + "x".repeat(100);
    expect(chapterNumber(long)).toBeNull();
  });

  it("handles Roman numerals with canonical round-trip rejection", () => {
    expect(chapterNumber("I: Loomings")).toBe(1);
    expect(chapterNumber("II. The Carpet-Bag")).toBe(2);
    expect(chapterNumber("IIII: Bad")).toBeNull(); // non-canonical
    expect(chapterNumber("VV. Also bad")).toBeNull();
    expect(chapterNumber("I")).toBeNull(); // bare divider, no title
  });

  it("handles CJK chapter headings", () => {
    expect(chapterNumber("第三章 缘起")).toBe(3);
    expect(chapterNumber("第１章")).toBe(1); // full-width digit
  });
});

describe("detectChapters — bare-heading title enrichment (#29)", () => {
  const prose = "This is a long wrapped prose line that keeps going well past the eighty character title cap limit.";

  it("pulls the title from the line after a bare heading (blank line between)", () => {
    const text = ["Chapter 1", "", "Introduction", prose, "Chapter 2", "", "PostGIS Installation", prose].join("\n");
    const r = detectChapters(text);
    expect(r.chapters.map((c) => c.heading)).toEqual(["Chapter 1 — Introduction", "Chapter 2 — PostGIS Installation"]);
  });

  it("keeps a same-line title untouched", () => {
    const text = ["Chapter 1. Getting Started", prose, "Chapter 2: Advanced", prose].join("\n");
    const r = detectChapters(text);
    expect(r.chapters.map((c) => c.heading)).toEqual(["Chapter 1. Getting Started", "Chapter 2: Advanced"]);
  });

  it("keeps the bare heading when the next line is not title-like", () => {
    // section number (digits/dots) and an overlong prose line are both rejected as titles
    const text = ["Chapter 1", "", "11.1.5", prose, "Chapter 2", "", prose].join("\n");
    const r = detectChapters(text);
    expect(r.chapters.map((c) => c.heading)).toEqual(["Chapter 1", "Chapter 2"]);
  });

  it("does not treat another chapter heading as the title", () => {
    const text = ["Chapter 1", "Chapter 2", "", "Real Title", prose].join("\n");
    const r = detectChapters(text);
    expect(r.chapters[0]!.heading).toBe("Chapter 1");
  });

  it("strips trailing punctuation from the bare heading before joining (Cyrillic)", () => {
    const text = ["Глава 1.", "", "Введение", prose, "Глава 2.", "", "Установка", prose].join("\n");
    const r = detectChapters(text);
    expect(r.chapters.map((c) => c.heading)).toEqual(["Глава 1 — Введение", "Глава 2 — Установка"]);
  });

  it("prefers a titled occurrence over a larger-bodied bare page-header", () => {
    // Running headers repeat "Chapter 1" mid-chapter with a bigger body than the real
    // titled heading; the titled occurrence must still win (book 911's Chapter 11).
    const page = `${prose}\n`;
    const text = ["Chapter 1", "", "Real Title", page.repeat(20), "Chapter 1", "", "11.1.5", page.repeat(100)].join("\n");
    const r = detectChapters(text);
    expect(r.chapters[0]!.heading).toBe("Chapter 1 — Real Title");
    expect(r.chapters[0]!.startChar).toBe(0);
  });

  it("does not promote a tiny ToC line over the bare body heading", () => {
    const body = `${prose}\n`.repeat(10);
    const text = ["Contents", "Chapter 1 Introduction 5", "", "Chapter 1", "", prose, body].join("\n");
    const r = detectChapters(text);
    expect(r.chapters[0]!.heading).toBe("Chapter 1");
  });

  it("startChar stays at the heading line, not the title line", () => {
    const text = ["Chapter 1", "", "Introduction", prose].join("\n");
    const r = detectChapters(text);
    expect(r.chapters[0]!.startChar).toBe(0);
  });
});

describe("detectChapters — numeric", () => {
  it("returns chapters with correct offsets and endChar chaining", () => {
    const text = ["Chapter 1", "aaa", "Chapter 2", "bbb", "Chapter 3", "ccc"].join("\n");
    const r = detectChapters(text);
    expect(r.detector).toBe("numeric");
    expect(r.chapters.map((c) => c.n)).toEqual([1, 2, 3]);
    // startChar of chapter 1 = 0; endChar chains to the next heading start.
    expect(r.chapters[0]!.startChar).toBe(0);
    expect(r.chapters[0]!.endChar).toBe(r.chapters[1]!.startChar);
    expect(r.chapters[2]!.endChar).toBe(text.length);
  });

  it("dedupes a ToC entry vs the body heading via largest-body pick", () => {
    // ToC lists chapters 1-2 near the top (tiny bodies), real bodies follow (large).
    const toc = ["Contents", "Chapter 1", "Chapter 2", ""].join("\n");
    const body1 = "Chapter 1\n" + "x".repeat(500) + "\n";
    const body2 = "Chapter 2\n" + "y".repeat(500);
    const text = toc + body1 + body2;
    const r = detectChapters(text);
    expect(r.hasToc).toBe(true);
    expect(r.chapters.map((c) => c.n)).toEqual([1, 2]);
    // Chapter 1 resolves to the BODY occurrence (front matter/ToC excluded).
    expect(r.chapters[0]!.startChar).toBeGreaterThan(toc.length - 5);
  });

  it("excludes front matter before the first kept chapter", () => {
    const text = "Preface text here.\n\nChapter 1\nbody";
    const r = detectChapters(text);
    expect(r.chapters[0]!.startChar).toBe(text.indexOf("Chapter 1"));
  });

  it("handles \\r\\n line endings with correct offsets", () => {
    const text = "Chapter 1\r\naaa\r\nChapter 2\r\nbbb";
    const r = detectChapters(text);
    expect(r.chapters[0]!.startChar).toBe(0);
    expect(r.chapters[1]!.startChar).toBe(text.indexOf("Chapter 2"));
  });
});

describe("detectChapters — structural fallback", () => {
  it("picks the shallowest depth with >= 2 distinct ATX titles", () => {
    const text = ["# Book Title", "intro", "## Introduction", "aaa", "## Methods", "bbb", "## Results", "ccc"].join("\n");
    const r = detectChapters(text);
    expect(r.detector).toBe("structural");
    expect(r.chapters.map((c) => c.heading)).toEqual(["Introduction", "Methods", "Results"]);
    expect(r.chapters.map((c) => c.n)).toEqual([1, 2, 3]);
  });

  it("recognizes setext underline headings", () => {
    const text = ["Introduction", "============", "aaa", "Methods", "=======", "bbb"].join("\n");
    const r = detectChapters(text);
    expect(r.detector).toBe("structural");
    expect(r.chapters.map((c) => c.heading)).toEqual(["Introduction", "Methods"]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const text = ["## Real One", "aaa", "```", "## Not A Heading", "code", "```", "## Real Two", "bbb"].join("\n");
    const r = detectChapters(text);
    expect(r.chapters.map((c) => c.heading)).toEqual(["Real One", "Real Two"]);
  });

  it("rejects bare-digit-led and punctuation-only ATX titles", () => {
    const text = ["## 5 Setup", "aaa", "## =====", "bbb", "## Alpha", "ccc", "## Beta", "ddd"].join("\n");
    const r = detectChapters(text);
    expect(r.chapters.map((c) => c.heading)).toEqual(["Alpha", "Beta"]);
  });

  it("rejects a setext underline shorter than its title", () => {
    const text = ["A Long Title Here", "==", "aaa"].join("\n"); // underline too short
    const r = detectChapters(text);
    expect(r.detector).toBe("none");
  });
});

describe("detectChapters — ToC + none", () => {
  it("detects Cyrillic ToC headers", () => {
    expect(detectChapters("Оглавление\n\nГлава 1\nbody").hasToc).toBe(true);
    expect(detectChapters("Зміст\n\nРозділ 1\nbody").hasToc).toBe(true);
  });

  it("returns detector=none with empty chapters for unstructured text", () => {
    const r = detectChapters("Just some prose with no headings at all. Nothing to see.");
    expect(r.detector).toBe("none");
    expect(r.chapters).toEqual([]);
  });
});

describe("frontMatterEnd", () => {
  it("returns the first chapter's start when front matter precedes it", () => {
    const front = "Praise for This Book\n\nGreat stuff.\n\nContents\n\nChapter 1: Alpha ..... 9\n";
    const body = "Chapter 1: Alpha\n\n" + "Real body prose about alpha. ".repeat(20) + "\nChapter 2: Beta\n\n" + "More body prose about beta. ".repeat(20);
    const text = front + body;
    expect(frontMatterEnd(text)).toBe(text.indexOf("Chapter 1: Alpha\n\nReal body"));
  });

  it("returns 0 when no chapters are detected", () => {
    expect(frontMatterEnd("Just prose with no headings at all. Nothing to see here.")).toBe(0);
  });

  it("returns 0 for a body that starts at the first chapter (no front matter)", () => {
    const text = "Chapter 1: Alpha\n\n" + "body ".repeat(50) + "\nChapter 2: Beta\n\n" + "body ".repeat(50);
    expect(frontMatterEnd(text)).toBe(0);
  });

  it("returns 0 when the boundary is implausibly deep (>20% of the text)", () => {
    // "Front matter" is 70% of the text — a detector miss, not a real boundary.
    const text = "prose ".repeat(500) + "\nChapter 1: Alpha\n\n" + "body ".repeat(200);
    expect(frontMatterEnd(text)).toBe(0);
  });
});
