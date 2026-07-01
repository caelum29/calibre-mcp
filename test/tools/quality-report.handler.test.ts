import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import type { ToolDeps } from "../../src/tools/types.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "Good Title", authors: ["Real Author"], authorSort: "Author, Real",
    identifiers: { isbn: "9780306406157" }, formats: ["pdf"], tags: ["t"], languages: ["en"],
    publisher: "P", pubdate: "2020-01-01", ...over };
}

function deps(fixture: Book[]): ToolDeps {
  const byId = new Map(fixture.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async () => ({ bookIds: fixture.map((b) => b.id), total: fixture.length, num: fixture.length, offset: 0, sort: "title", libraryId: "Lib" }),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    embedder: {} as unknown as ToolDeps["embedder"],
    index: {} as unknown as ToolDeps["index"],
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
      book({ id: 1, title: "795731065", authors: ["Unknown"], identifiers: {}, tags: [], publisher: undefined, pubdate: undefined }),
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
    const fixture = Array.from({ length: 5 }, (_, i) => book({ id: i + 1, title: `${1000 + i}`, identifiers: {}, tags: [], publisher: undefined, pubdate: undefined }));
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
});
