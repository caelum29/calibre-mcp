import { describe, expect, it } from "vitest";
import { isPlaceholderTitle, isUsableTitle, looksLikeRawFilename } from "../../../src/domain/enrich/filename-guess.js";

describe("looksLikeRawFilename", () => {
  it("catches the original three shapes (digits, ASIN, file extension)", () => {
    expect(looksLikeRawFilename("795731065")).toBe(true);
    expect(looksLikeRawFilename("B0CZS7H23N")).toBe(true);
    expect(looksLikeRawFilename("weuc-draft1.PDF")).toBe(true);
    expect(looksLikeRawFilename("hp.dvi")).toBe(true);
  });

  it("catches digit+hyphen identifier ids", () => {
    expect(looksLikeRawFilename("215479-01")).toBe(true);
    expect(looksLikeRawFilename("215479_01")).toBe(true);
  });

  it("catches all-lowercase kebab-case slugs", () => {
    expect(looksLikeRawFilename("pro-vim-2014")).toBe(true);
    expect(looksLikeRawFilename("tmux-taster-2014")).toBe(true);
    expect(looksLikeRawFilename("devops-web-development")).toBe(true);
    expect(looksLikeRawFilename("developing-microservices-node-js")).toBe(true);
    expect(looksLikeRawFilename("advanced-microservices")).toBe(true);
    expect(looksLikeRawFilename("bdd-in-action")).toBe(true);
    expect(looksLikeRawFilename("why-startups-fail-and-how-yours-can-succeed")).toBe(true);
    expect(looksLikeRawFilename("rest-advanced-research-topics-and-practical-applications")).toBe(true);
  });

  it("catches placeholder titles", () => {
    expect(looksLikeRawFilename("Cover")).toBe(true);
    expect(looksLikeRawFilename("cover")).toBe(true);
    expect(looksLikeRawFilename("Untitled")).toBe(true);
    expect(looksLikeRawFilename("Contents")).toBe(true);
    expect(looksLikeRawFilename("book (3)")).toBe(true);
    expect(looksLikeRawFilename("Book (12)")).toBe(true);
  });

  it("catches a real title whose trailing parenthetical is the author", () => {
    expect(looksLikeRawFilename("Go Design Patterns (Mario Castro Contreras)", ["Mario Castro Contreras"])).toBe(true);
    expect(looksLikeRawFilename("Head First Design Patterns (Eric Freeman)", ["Eric Freeman"])).toBe(true);
    // Without authors passed, the plain title is not flagged.
    expect(looksLikeRawFilename("Go Design Patterns (Mario Castro Contreras)")).toBe(false);
  });

  it("catches a duplicate-download copy suffix", () => {
    expect(looksLikeRawFilename("Test-Driven JavaScript Development (1)")).toBe(true);
  });

  it("matches the author parenthetical exactly, not by containment", () => {
    expect(looksLikeRawFilename("Clean Code (Robert C. Martin Series)", ["Robert C. Martin"])).toBe(false);
    expect(looksLikeRawFilename("Foo Bar (Smith)", ["John Smith"])).toBe(false);
    expect(looksLikeRawFilename("Programming (C)", ["C"])).toBe(true);
    // Calibre's "Unknown" author is a placeholder, never a match.
    expect(looksLikeRawFilename("Some Title (Unknown)", ["Unknown"])).toBe(false);
  });

  it("does NOT flag ordinary human titles", () => {
    expect(looksLikeRawFilename("A Good Book Title")).toBe(false);
    expect(looksLikeRawFilename("The Pragmatic Programmer")).toBe(false);
    expect(looksLikeRawFilename("Head First Design Patterns")).toBe(false);
    expect(looksLikeRawFilename("Go Design Patterns")).toBe(false);
    // Title-case with a space is not a slug.
    expect(looksLikeRawFilename("Pro Vim")).toBe(false);
    // A parenthetical that is not the author is kept.
    expect(looksLikeRawFilename("Design Patterns (2nd Edition)", ["Eric Freeman"])).toBe(false);
    // A bare trailing number is a volume/version, not a copy suffix.
    expect(looksLikeRawFilename("Test-Driven JavaScript Development 2")).toBe(false);
    expect(looksLikeRawFilename("Python 3")).toBe(false);
    // Empty title is not raw (handled by callers).
    expect(looksLikeRawFilename("")).toBe(false);
  });
});

describe("isPlaceholderTitle", () => {
  it("is true only for importer placeholders", () => {
    expect(isPlaceholderTitle("Cover")).toBe(true);
    expect(isPlaceholderTitle("book (3)")).toBe(true);
    expect(isPlaceholderTitle("pro-vim-2014")).toBe(false);
  });
});

describe("isUsableTitle", () => {
  it("treats a raw slug title as unusable (fall back to ISBN)", () => {
    expect(isUsableTitle("pro-vim-2014")).toBe(false);
    expect(isUsableTitle("Cover")).toBe(false);
    expect(isUsableTitle("215479-01")).toBe(false);
  });

  it("treats a real title as usable", () => {
    expect(isUsableTitle("Head First Design Patterns")).toBe(true);
    expect(isUsableTitle("Pro Vim")).toBe(true);
  });

  it("treats a too-short title as unusable regardless", () => {
    expect(isUsableTitle("ab")).toBe(false);
    expect(isUsableTitle("")).toBe(false);
  });
});
