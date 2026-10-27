// Heading-structured front matter (#102): shapes lifted from real EPUB→Markdown
// conversions in the library (O'Reilly, Manning, Packt, No Starch), shortened.
import { describe, it, expect } from "vitest";
import {
  anchorNumber,
  cleanHeading,
  FM_SHORT_SECTION_CHARS,
  frontMatterEnd,
  isFrontMatterTitle,
  leadingFrontMatter,
} from "../../../src/domain/structure/front-matter.js";

const body = (n: number) =>
  "Body prose sentence about the topic at hand. ".repeat(Math.ceil(n / 45)).slice(0, n) + "\n\n";

describe("cleanHeading", () => {
  it("strips emphasis, escapes and number boxes", () => {
    expect(cleanHeading("**Chapter 1. **Introduction to Vector Databases")).toBe(
      "Chapter 1. Introduction to Vector Databases",
    );
    expect(cleanHeading("CHAPTER 1**Routing**")).toBe("CHAPTER 1 Routing");
    expect(cleanHeading("**1****  ")).toBe("1");
    expect(cleanHeading("\\[ 1 \\]")).toBe("1");
    expect(cleanHeading("Hello Rust\\!")).toBe("Hello Rust!");
  });
});

describe("anchorNumber", () => {
  it("reads first-chapter shapes", () => {
    expect(anchorNumber("Chapter 1. LLM Applications")).toBe(1);
    expect(anchorNumber("CHAPTER 1")).toBe(1);
    expect(anchorNumber("1 Meeting Postgres")).toBe(1);
    expect(anchorNumber("1. Promise Basics")).toBe(1);
    expect(anchorNumber("1")).toBe(1);
    expect(anchorNumber("Part I")).toBe(1);
    expect(anchorNumber("Part 1: Introduction to Ghidra")).toBe(1);
    expect(anchorNumber("Глава 1. Основы")).toBe(1);
  });

  it("rejects sub-numbering and prose", () => {
    expect(anchorNumber("1.1 Type-checking JavaScript")).toBeNull();
    expect(anchorNumber("Why Vector Databases?")).toBeNull();
  });
});

describe("isFrontMatterTitle", () => {
  it("matches whole front-matter titles EN + RU/UK", () => {
    for (const t of [
      "Preface",
      "Praise for The Manager’s Path",
      "Revision History for the First Edition",
      "Table of Contents",
      "About the Author",
      "Why subscribe?",
      "Conventions used",
      "Предисловие",
      "Об авторе",
      "Зміст",
    ]) {
      expect(isFrontMatterTitle(t), t).toBe(true);
    }
  });

  it("does not match body titles that merely contain a front-matter word", () => {
    for (const t of ["Prefaces in Kotlin", "Contents of a Docker Image", "Introduction", "Getting Started with Rust"]) {
      expect(isFrontMatterTitle(t), t).toBe(false);
    }
  });
});

describe("leadingFrontMatter — anchor rule", () => {
  it("ends front matter at the decorated Chapter 1 heading (book 929 shape)", () => {
    const text =
      "# Vector Databases\n\nA Practical Introduction\n\n# Vector Databases\n\nCopyright © 2026.\n\n" +
      "# Preface\n\n" +
      body(4000) +
      "# Who This Book Is For\n\n" +
      body(3000) +
      "# **Chapter 1. **Introduction to Vector Databases\n\n" +
      body(9000) +
      "# **Chapter 2. **Embeddings\n\n" +
      body(60_000);
    const r = leadingFrontMatter(text);
    expect(r.rule).toBe("anchor");
    expect(text.slice(r.end)).toMatch(/^# \*\*Chapter 1\./);
  });

  it("skips a TOC rendered as headings: picks the Chapter 1 with the longest run to Chapter 2", () => {
    const text =
      "# Book\n\n# Table of Contents\n\n## Chapter 1. Basics\n\n## Chapter 2. More\n\n" +
      body(500) +
      "# Chapter 1. Basics\n\n" +
      body(8000) +
      "# Chapter 2. More\n\n" +
      body(60_000);
    const r = leadingFrontMatter(text);
    expect(text.slice(r.end)).toMatch(/^# Chapter 1\. Basics\n\n Body|^# Chapter 1\. Basics\n\nBody/);
    expect(r.end).toBeGreaterThan(text.indexOf("## Chapter 2"));
  });

  it("starts the body at Part I when it directly precedes Chapter 1", () => {
    const text =
      "# Title\n\n# Preface\n\n" +
      body(3000) +
      "# Part I\n\n" +
      body(300) +
      "## Chapter 1. Start\n\n" +
      body(8000) +
      "## Chapter 2. Next\n\n" +
      body(50_000);
    expect(leadingFrontMatter(text).heading).toBe("Part I");
  });

  it("ignores a numbered list item that only looks like a chapter heading", () => {
    const text =
      "# MySQL Architecture\n\n" +
      body(3000) +
      "### **1.** **Transaction Support**\n\n" +
      body(300) +
      "### **2.** **Locking**\n\n" +
      body(300) +
      "# Indexes\n\n" +
      body(60_000);
    expect(leadingFrontMatter(text).rule).not.toBe("anchor");
  });

  it("claims nothing when Chapter 1 sits past the plausibility cap", () => {
    const text =
      "# Title\n\n" + body(40_000) + "# Chapter 1. Late\n\n" + body(5000) + "# Chapter 2. Later\n\n" + body(5000);
    expect(leadingFrontMatter(text).end).toBe(0);
  });
});

describe("leadingFrontMatter — run rule", () => {
  it("walks Packt boilerplate and stops at the first unnamed section, even a short one", () => {
    const text =
      "# Learning Rust\n\n" +
      body(800) +
      "# Why subscribe?\n\n" +
      body(300) +
      "# About the Authors\n\n" +
      body(1500) +
      "# Table of Contents\n\n" +
      body(6000) +
      "# Preface\n\n" +
      body(1000) +
      "# What this book covers\n\n" +
      body(1500) +
      "# Introducing and Installing Rust\n\n" +
      body(600) +
      "# Installing Rust\n\n" +
      body(60_000);
    const r = leadingFrontMatter(text);
    expect(r.rule).toBe("run");
    expect(r.heading).toBe("Introducing and Installing Rust");
  });

  it("treats short unnamed sections before any named one as title-page stubs", () => {
    const text =
      "# The Book\n\n" +
      body(FM_SHORT_SECTION_CHARS - 500) +
      "# Acknowledgments\n\n" +
      body(1000) +
      "# INTRODUCTION\n\n" +
      body(60_000);
    expect(leadingFrontMatter(text).heading).toBe("INTRODUCTION");
  });

  it("claims nothing when the very first section is long body content", () => {
    expect(leadingFrontMatter("# Getting Started\n\n" + body(30_000) + "# Next\n\n" + body(30_000)).end).toBe(0);
  });

  it("does not run on texts whose first heading is deep in the body (PDF code comments)", () => {
    const text =
      body(5000) + "# Iterate over the retrieved documents\n\n" + body(500) + "# Close connection\n\n" + body(60_000);
    expect(leadingFrontMatter(text).end).toBe(0);
  });

  it("returns none for heading-less text", () => {
    expect(leadingFrontMatter(body(10_000))).toEqual({ end: 0, rule: "none" });
  });
});

describe("frontMatterEnd — combined boundary", () => {
  it("claims the heading-structured front matter the structural detector misses (book 929)", () => {
    const text =
      "# Vector Databases\n\nCopyright © 2026.\n\n# Preface\n\n" +
      body(6000) +
      "# **Chapter 1. **Introduction\n\n" +
      body(9000) +
      "# **Chapter 2. **Embeddings\n\n" +
      body(60_000);
    expect(frontMatterEnd(text)).toBe(text.indexOf("# **Chapter 1."));
  });

  it("keeps the chapter detector's boundary when it is later than the heading rules'", () => {
    // Plain-text front matter, no Markdown headings: only the numeric detector sees it.
    const front = "Praise for This Book\n\nGreat stuff.\n\nContents\n\nChapter 1: Alpha ..... 9\n";
    const text =
      front +
      "Chapter 1: Alpha\n\n" +
      "Real body prose. ".repeat(40) +
      "\nChapter 2: Beta\n\n" +
      "More prose. ".repeat(40);
    expect(frontMatterEnd(text)).toBe(text.indexOf("Chapter 1: Alpha\n\nReal body"));
  });
});
