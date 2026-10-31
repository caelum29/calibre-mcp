import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

function book(over: Partial<Book> = {}): Book {
  return {
    id: 1,
    uuid: "u",
    title: "Good Title",
    authors: ["Real Author"],
    authorSort: "Author, Real",
    identifiers: { isbn: "9780306406157" },
    formats: ["pdf"],
    tags: ["t"],
    languages: ["en"],
    publisher: "P",
    pubdate: "2020-01-01",
    ...over,
  };
}

function deps(fixture: Book[]): BaseDeps {
  const byId = new Map(fixture.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async () => ({
      bookIds: fixture.map((b) => b.id),
      total: fixture.length,
      num: fixture.length,
      offset: 0,
      sort: "title",
      libraryId: "Lib",
    }),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({ limit: 100, ...over });

describe("calibre_quality_report handler", () => {
  it("reports no issues on a clean library", async () => {
    const r = await qualityReportTool.handler(args(), deps([book()]));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ total: 0, booksScanned: 1 });
  });

  it("flags raw-filename titles and missing metadata", async () => {
    const fixture = [
      book({
        id: 1,
        title: "795731065",
        authors: ["Unknown"],
        identifiers: {},
        tags: [],
        publisher: undefined,
        pubdate: undefined,
      }),
    ];
    const r = await qualityReportTool.handler(args(), deps(fixture));
    const byCheck = r.structuredContent?.byCheck as Record<string, number>;
    expect(byCheck.raw_filename_title).toBe(1);
    expect(byCheck.missing_metadata).toBe(1);
  });

  it("honors the checks filter", async () => {
    const fixture = [book({ id: 1, title: "12345", identifiers: {}, tags: [] })];
    const r = await qualityReportTool.handler(args({ checks: ["raw_filename_title"] }), deps(fixture));
    const byCheck = r.structuredContent?.byCheck as Record<string, number>;
    expect(Object.keys(byCheck)).toEqual(["raw_filename_title"]);
  });

  it("paginates issues with a nextCursor", async () => {
    const fixture = Array.from({ length: 5 }, (_, i) =>
      book({ id: i + 1, title: `${1000 + i}`, identifiers: {}, tags: [], publisher: undefined, pubdate: undefined }),
    );
    const first = await qualityReportTool.handler(args({ limit: 3 }), deps(fixture));
    expect(first.structuredContent?.count).toBe(3);
    const cursor = first.structuredContent?.nextCursor as string;
    expect(cursor).toBeTruthy();
    const second = await qualityReportTool.handler(args({ limit: 3, cursor }), deps(fixture));
    expect(second.structuredContent?.offset).toBe(3);
  });

  it("notes readability is deferred when requested", async () => {
    const r = await qualityReportTool.handler(args({ readability: true }), deps([book()]));
    expect((r.content[0] as { text: string }).text).toContain("readability");
  });

  // #212: the Cowork serialization bug stringifies booleans — "true" must still opt in.
  it('accepts readability as the string "true" and notes the deferral', async () => {
    const parsed = z.object(qualityReportTool.inputSchema).safeParse({ readability: "true" });
    expect(parsed.success).toBe(true);
    const r = await qualityReportTool.handler(parsed.data!, deps([book()]));
    expect((r.content[0] as { text: string }).text).toContain("readability check is not implemented yet");
  });

  it('reads readability "false" as false (no deferral note)', async () => {
    const parsed = z.object(qualityReportTool.inputSchema).safeParse({ readability: "false" });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.readability).toBe(false);
    const r = await qualityReportTool.handler(parsed.data!, deps([book()]));
    expect((r.content[0] as { text: string }).text).not.toContain("readability");
  });
});

// issue #211 — the issue-page cursor must reach text-only clients (Desktop), outside the fence
describe("calibre_quality_report cursor in text (#211)", () => {
  const raw = Array.from({ length: 5 }, (_, i) =>
    book({ id: i + 1, title: `${1000 + i}`, identifiers: {}, tags: [], publisher: undefined, pubdate: undefined }),
  );

  it("ends with the continue-with-cursor line carrying nextCursor", async () => {
    const r = await qualityReportTool.handler(args({ limit: 3, checks: ["raw_filename_title"] }), deps(raw));
    const cursor = r.structuredContent?.nextCursor as string;
    expect(cursor).toBeTypeOf("string");
    expect(r.content.at(-1)).toEqual({ type: "text", text: `More results — continue with cursor: ${cursor}` });
  });

  it("has no cursor line on the last page", async () => {
    const r = await qualityReportTool.handler(args({ limit: 5, checks: ["raw_filename_title"] }), deps(raw));
    expect(r.structuredContent?.count).toBe(5);
    expect(JSON.stringify(r.content)).not.toContain("continue with cursor");
  });
});

// issue #199 — Claude Code shows only structuredContent, so the per-issue lines must be
// mirrored there as issues[] (the page, same order as the text)
describe("calibre_quality_report issues[] in structuredContent (#199)", () => {
  interface Issue {
    bookId: number;
    title: string;
    check: string;
    severity: string;
    message: string;
  }
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
  const raw = Array.from({ length: 3 }, (_, i) => book({ id: i + 1, title: `${1000 + i}` }));

  it("mirrors each issue line of the page", async () => {
    const r = await qualityReportTool.handler(args({ checks: ["raw_filename_title"] }), deps(raw));
    const issues = r.structuredContent?.issues as Issue[];
    expect(issues.map((i) => [i.bookId, i.title, i.check])).toEqual([
      [1, "1000", "raw_filename_title"],
      [2, "1001", "raw_filename_title"],
      [3, "1002", "raw_filename_title"],
    ]);
    for (const i of issues) {
      expect(text(r)).toContain(`[${i.severity}] #${i.bookId} "${i.title}" — ${i.check}: ${i.message}`);
    }
  });

  it("carries only the current page's issues", async () => {
    const first = await qualityReportTool.handler(args({ limit: 2, checks: ["raw_filename_title"] }), deps(raw));
    const second = await qualityReportTool.handler(
      args({ limit: 2, checks: ["raw_filename_title"], cursor: first.structuredContent?.nextCursor }),
      deps(raw),
    );
    const issues = second.structuredContent?.issues as Issue[] | undefined;
    expect(issues?.map((i) => i.bookId)).toEqual([3]);
  });

  it("returns an empty issues[] on a clean library", async () => {
    const r = await qualityReportTool.handler(args(), deps([book()]));
    expect(r.structuredContent?.issues).toEqual([]);
  });
});

// #227 — the report stays one fenced text block (titles are untrusted book data)
describe("calibre_quality_report report block", () => {
  it("renders the report as a fenced QUALITY REPORT text block", async () => {
    const r = await qualityReportTool.handler(args(), deps([book()]));
    expect(r.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("--- BEGIN UNTRUSTED QUALITY REPORT"),
    });
  });
});
