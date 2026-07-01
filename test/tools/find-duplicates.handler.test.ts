import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { findDuplicatesTool } from "../../src/tools/calibre_find_duplicates.js";
import type { ToolDeps } from "../../src/tools/types.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

/** Fake content client: search returns all ids; booksByIds serves from a fixture map. */
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

const args = (over: Record<string, unknown> = {}) => ({ mode: "identical" as const, limit: 50, ...over });

describe("calibre_find_duplicates handler", () => {
  it("returns identical-title groups with resource_links + merge safety", async () => {
    const fixture = [
      book({ id: 1, title: "Rust", authors: ["A"], formats: ["pdf"] }),
      book({ id: 2, title: "rust", authors: ["a"], formats: ["epub"] }),
      book({ id: 3, title: "Go", authors: ["B"] }),
    ];
    const r = await findDuplicatesTool.handler(args(), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ mode: "identical", groupCount: 1, booksScanned: 3 });
    expect(r.content.some((b) => b.type === "resource_link")).toBe(true);
  });

  it("paginates groups with a nextCursor", async () => {
    // 4 distinct duplicate groups; page size 2 → cursor after the first page.
    const fixture: Book[] = [];
    for (let g = 0; g < 4; g++) {
      fixture.push(book({ id: g * 2 + 1, title: `T${g}`, authors: ["X"] }));
      fixture.push(book({ id: g * 2 + 2, title: `t${g}`, authors: ["x"] }));
    }
    const first = await findDuplicatesTool.handler(args({ limit: 2 }), deps(fixture));
    expect(first.structuredContent?.count).toBe(2);
    const cursor = first.structuredContent?.nextCursor as string;
    expect(cursor).toBeTruthy();
    const second = await findDuplicatesTool.handler(args({ limit: 2, cursor }), deps(fixture));
    expect(second.structuredContent?.offset).toBe(2);
  });

  it("compare requires at least 2 ids", async () => {
    const r = await findDuplicatesTool.handler(args({ mode: "compare", ids: [1] }), deps([book({ id: 1 })]));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("at least 2");
  });

  it("compare diffs an explicit id set and recommends a keep", async () => {
    const fixture = [
      book({ id: 1, title: "T", authors: ["A"], formats: ["pdf"] }),
      book({ id: 2, title: "T", authors: ["A"], formats: ["pdf", "epub"], publisher: "P" }),
    ];
    const r = await findDuplicatesTool.handler(args({ mode: "compare", ids: [1, 2] }), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ mode: "compare", keep: 2 });
  });

  it("notes that binary mode is deferred", async () => {
    const r = await findDuplicatesTool.handler(args(), deps([book({ id: 1, title: "X" })]));
    expect((r.content[0] as { text: string }).text).toContain("binary mode");
  });
});
