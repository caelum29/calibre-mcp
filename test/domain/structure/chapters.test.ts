import { describe, it, expect } from "vitest";
import { chapterNumber, detectChapters } from "../../../src/domain/structure/chapters.js";

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
