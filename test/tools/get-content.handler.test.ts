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
});
