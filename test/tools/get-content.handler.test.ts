import { describe, it, expect } from "vitest";
import { getContentTool } from "../../src/tools/calibre_get_content.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { ToolDeps } from "../../src/tools/types.js";

const baseBook: Book = {
  id: 1,
  uuid: "u-1",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
};

interface FakeOpts {
  book?: Partial<Book>;
  getText?: () => Promise<ExtractedText>;
}

function deps(opts: FakeOpts = {}): ToolDeps {
  const content = {
    getBook: async (): Promise<Book> => ({ ...baseBook, ...opts.book }),
    resolveLibraryId: async () => "Programming_Books",
  };
  const extractor = {
    getText:
      opts.getText ??
      (async (): Promise<ExtractedText> => ({
        text: "x".repeat(20_000),
        backend: "pdftotext",
        chars: 20_000,
        cached: false,
      })),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: extractor as unknown as ToolDeps["extractor"],
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({
  id: 1,
  maxChars: 8_000,
  sentenceAware: false,
  ...over,
});

describe("calibre_get_content handler", () => {
  it("returns a fenced excerpt with a nextCursor when more remains", async () => {
    const r = await getContentTool.handler(args(), deps());
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect((r.content[0] as { text: string }).text).toContain("BOOK CONTENT");
    expect(r.structuredContent).toMatchObject({ format: "pdf", backend: "pdftotext", hasMore: true });
    expect(r.structuredContent?.nextCursor).toBeTypeOf("string");
  });

  it("errors when the book has no extractable format", async () => {
    const r = await getContentTool.handler(args(), deps({ book: { formats: [] } }));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("no extractable text format");
  });

  it("reports a scanned/image PDF when extraction is empty", async () => {
    const r = await getContentTool.handler(
      args(),
      deps({ getText: async () => ({ text: "   ", backend: "pdftotext", chars: 3, cached: false }) }),
    );
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("scanned/image PDF");
  });

  it("maps a missing PDF backend to an install hint", async () => {
    const r = await getContentTool.handler(
      args(),
      deps({
        getText: async () => {
          throw new Error("NO_PDF_BACKEND");
        },
      }),
    );
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("poppler");
  });

  describe("id / bookId alias", () => {
    it("accepts the bookId alias (search results expose bookIds) in place of id", async () => {
      const r = await getContentTool.handler(args({ id: undefined, bookId: 1 }), deps());
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({ format: "pdf" });
    });

    it("errors when neither id nor bookId is given", async () => {
      const r = await getContentTool.handler(args({ id: undefined }), deps());
      expect(r.isError).toBe(true);
      expect((r.content[0] as { text: string }).text).toContain("Provide id");
    });
  });

  describe("structure=true", () => {
    const chapterText = ["Chapter 1", "aaa aaa aaa", "Chapter 2", "bbb bbb bbb", "Chapter 3", "ccc ccc ccc"].join("\n");
    const withChapters = () =>
      deps({ getText: async () => ({ text: chapterText, backend: "pdftotext", chars: chapterText.length, cached: false }) });

    it("returns a chapter map with per-chapter cursors, not book text", async () => {
      const r = await getContentTool.handler(args({ structure: true }), withChapters());
      expect(r.isError).toBeFalsy();
      const text = (r.content[0] as { text: string }).text;
      expect(text).toContain("CHAPTERS");
      expect(text).not.toContain("aaa aaa aaa"); // book body is NOT dumped
      const sc = r.structuredContent as { chapters?: { n: number; cursor: string }[]; detector?: string };
      expect(sc.detector).toBe("numeric");
      expect(sc.chapters?.map((c) => c.n)).toEqual([1, 2, 3]);
      expect(sc.chapters?.[0]?.cursor).toBeTypeOf("string");
    });

    it("coerces string 'true'/'1' for the structure flag", async () => {
      for (const v of ["true", "1"]) {
        const r = await getContentTool.handler(args({ structure: v }), withChapters());
        expect(r.isError).toBeFalsy();
        expect((r.structuredContent as { detector?: string }).detector).toBe("numeric");
      }
    });

    it("a per-chapter cursor seeks to that chapter in a follow-up get_content call", async () => {
      const map = await getContentTool.handler(args({ structure: true }), withChapters());
      const cursor = (map.structuredContent as { chapters: { cursor: string }[] }).chapters[1]!.cursor;
      const page = await getContentTool.handler(args({ cursor }), withChapters());
      expect(page.isError).toBeFalsy();
      expect((page.structuredContent as { offset: number }).offset).toBe(chapterText.indexOf("Chapter 2"));
    });

    it("reports 0 chapters as a non-error with a steer to the plain walk", async () => {
      const flat = "Just prose, no headings anywhere in this book at all.";
      const r = await getContentTool.handler(
        args({ structure: true }),
        deps({ getText: async () => ({ text: flat, backend: "pdftotext", chars: flat.length, cached: false }) }),
      );
      expect(r.isError).toBeFalsy();
      expect((r.structuredContent as { chapters: unknown[] }).chapters).toEqual([]);
      expect((r.content[0] as { text: string }).text).toContain("No chapters detected");
    });
  });
});
