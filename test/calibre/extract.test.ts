import { describe, it, expect } from "vitest";
import {
  chooseExtractFormat,
  ebookConvertArgs,
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

describe("text cache envelope (v2, #84)", () => {
  it("round-trips a valid envelope", () => {
    const env = { v: 2, backend: "pdftotext", text: "body [image #0]", markers: [{ index: 0, charOffset: 5, page: 1, caption: "c" }] };
    expect(parseTextCacheEnvelope(JSON.stringify(env))).toEqual(env);
  });
  it("rejects a pre-marker cache payload (raw text, no envelope)", () => {
    expect(parseTextCacheEnvelope("just extracted text")).toBeNull();
  });
  it("rejects a stale envelope version", () => {
    expect(parseTextCacheEnvelope(JSON.stringify({ v: 1, backend: "x", text: "t", markers: [] }))).toBeNull();
  });
  it("rejects an envelope missing markers", () => {
    expect(parseTextCacheEnvelope(JSON.stringify({ v: 2, backend: "x", text: "t" }))).toBeNull();
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
