import { describe, it, expect } from "vitest";
import {
  chooseExtractFormat,
  ebookConvertArgs,
  isEvictableCacheFile,
  noTextReason,
  parseTextCacheEnvelope,
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
  it("extracts a markdown-only book (#12)", () => {
    expect(chooseExtractFormat(["md"])).toBe("md");
  });
  it("accepts Calibre's other markdown spelling", () => {
    expect(chooseExtractFormat(["markdown"])).toBe("markdown");
  });
  it("prefers markdown over pdf — headings survive the conversion", () => {
    expect(chooseExtractFormat(["pdf", "md"])).toBe("md");
  });
  it("still prefers epub over markdown", () => {
    expect(chooseExtractFormat(["md", "epub"])).toBe("epub");
  });
  it("extracts an ODT-only book (#132)", () => {
    expect(chooseExtractFormat(["odt"])).toBe("odt");
  });
  it("ranks odt right after docx (both word-processor formats)", () => {
    expect(chooseExtractFormat(["fb2", "odt"])).toBe("odt");
    expect(chooseExtractFormat(["odt", "docx"])).toBe("docx");
  });
  it("leaves spreadsheets (ods) unsupported", () => {
    expect(chooseExtractFormat(["ods"])).toBeUndefined();
  });
});

describe("noTextReason", () => {
  it("blames OCR for an empty pdf", () => {
    expect(noTextReason("pdf")).toContain("no OCR");
  });
  it("calls an empty markdown file empty, not image-only", () => {
    expect(noTextReason("md")).toBe("the MD file is empty or holds no readable text");
  });
  it("blames the text layer for an empty epub", () => {
    expect(noTextReason("epub")).toContain("no extractable text layer");
  });
});

describe("text cache envelope (v7, #84/#133/#134/#101/#107)", () => {
  it("round-trips a valid envelope", () => {
    const env = {
      v: 7,
      backend: "pdftotext",
      text: "body [image #0]",
      markers: [{ index: 0, charOffset: 5, page: 1, caption: "c" }],
    };
    expect(parseTextCacheEnvelope(JSON.stringify(env))).toEqual(env);
  });
  it("rejects a pre-marker cache payload (raw text, no envelope)", () => {
    expect(parseTextCacheEnvelope("just extracted text")).toBeNull();
  });
  it("rejects a stale envelope version", () => {
    expect(parseTextCacheEnvelope(JSON.stringify({ v: 1, backend: "x", text: "t", markers: [] }))).toBeNull();
  });
  it("rejects a v2 envelope — PyMuPDF text cached before \\f page breaks (#133)", () => {
    expect(
      parseTextCacheEnvelope(JSON.stringify({ v: 2, backend: "pymupdf", text: "p1\np2", markers: [] })),
    ).toBeNull();
  });
  it("rejects a v4 envelope — EPUB text cached before the #101 caption-matching fix", () => {
    expect(
      parseTextCacheEnvelope(JSON.stringify({ v: 4, backend: "ebook-convert", text: "t", markers: [] })),
    ).toBeNull();
  });
  it("rejects a v3 envelope — cached before the PDF outline rode along (#134)", () => {
    expect(parseTextCacheEnvelope(JSON.stringify({ v: 3, backend: "pdftotext", text: "t", markers: [] }))).toBeNull();
  });
  it("rejects a v6 envelope — PDF markers cached before layout-read captions carry no caption text", () => {
    expect(parseTextCacheEnvelope(JSON.stringify({ v: 6, backend: "pdftotext", text: "t", markers: [] }))).toBeNull();
  });
  it("rejects an envelope missing markers", () => {
    expect(parseTextCacheEnvelope(JSON.stringify({ v: 7, backend: "x", text: "t" }))).toBeNull();
  });
  it("round-trips the outline and the unplaced count", () => {
    const env = {
      v: 7,
      backend: "pdftotext",
      text: "t",
      markers: [],
      unplaced: 2,
      outline: [{ title: "Intro", page: 3, level: 1 }],
    };
    expect(parseTextCacheEnvelope(JSON.stringify(env))).toEqual(env);
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

describe("isEvictableCacheFile (#99 concurrent builds)", () => {
  it("evicts cache entries: text envelopes, legacy .txt, figure inventories", () => {
    expect(isEvictableCacheFile("0123456789abcdef0123456789abcdef.v4.json")).toBe(true);
    expect(isEvictableCacheFile("0123456789abcdef0123456789abcdef.txt")).toBe(true);
    expect(isEvictableCacheFile("fg-0123456789abcdef0123456789abcdef.json")).toBe(true);
  });

  it("never evicts another book's in-flight temp files", () => {
    expect(isEvictableCacheFile("tx-6f1c2a9e-1b2c-4d5e-8f90-123456789abc.txt")).toBe(false);
    expect(isEvictableCacheFile("fg-6f1c2a9e-1b2c-4d5e-8f90-123456789abc.txt")).toBe(false);
    expect(isEvictableCacheFile("dl-6f1c2a9e-1b2c-4d5e-8f90-123456789abc.pdf")).toBe(false);
    expect(isEvictableCacheFile("fx-6f1c2a9e-1b2c-4d5e-8f90-123456789abc")).toBe(false);
  });
});
