import { describe, it, expect } from "vitest";
import {
  chooseExtractFormat,
  ebookConvertArgs,
  pdftotextArgs,
} from "../../src/calibre/extract.js";

describe("chooseExtractFormat", () => {
  it("prefers epub over pdf when both exist", () => {
    expect(chooseExtractFormat(["pdf", "epub"])).toBe("epub");
  });
  it("honors an explicit, available preference", () => {
    expect(chooseExtractFormat(["pdf", "epub"], "pdf")).toBe("pdf");
  });
  it("ignores an unavailable preference and falls back", () => {
    expect(chooseExtractFormat(["pdf"], "mobi")).toBe("pdf");
  });
  it("returns undefined when nothing is extractable", () => {
    expect(chooseExtractFormat(["cbz", "djvu"])).toBeUndefined();
  });
});

describe("extractor argv builders", () => {
  it("pdftotext uses UTF-8 and quiet", () => {
    expect(pdftotextArgs("/a.pdf", "/a.txt")).toEqual(["-q", "-enc", "UTF-8", "/a.pdf", "/a.txt"]);
  });
  it("ebook-convert uses markdown and NEVER --asciiize (kills Cyrillic)", () => {
    const args = ebookConvertArgs("/a.epub", "/a.txt");
    expect(args).toContain("--txt-output-formatting=markdown");
    expect(args).not.toContain("--asciiize");
  });
});
