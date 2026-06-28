import { describe, it, expect } from "vitest";
import { searchTool } from "../../src/tools/calibre_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { SearchPage } from "../../src/domain/search.js";
import type { ToolDeps } from "../../src/tools/types.js";

const book = (id: number): Book => ({
  id,
  uuid: `u-${id}`,
  title: `Book ${id}`,
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
});

// Fake deps with only the content methods the handler touches (boundary stub).
function deps(page: SearchPage): ToolDeps {
  const content = {
    search: async (): Promise<SearchPage> => page,
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)])),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    log,
  };
}

const page = (over: Partial<SearchPage> = {}): SearchPage => ({
  bookIds: [1, 2],
  total: 5,
  num: 2,
  offset: 0,
  sort: "title",
  libraryId: "L",
  ...over,
});

describe("calibre_search handler", () => {
  it("degrades gracefully for unimplemented fts mode", async () => {
    const r = await searchTool.handler(
      { query: "x", mode: "fts", scope: "library", limit: 20 },
      deps(page()),
    );
    expect(r.isError).toBe(true);
    expect(r.content[0]).toMatchObject({ type: "text" });
  });

  it("returns one resource_link per hit plus a summary line", async () => {
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20 },
      deps(page()),
    );
    expect(r.isError).toBeFalsy();
    // 1 summary text block + 2 resource_links
    expect(r.content.filter((c) => c.type === "resource_link")).toHaveLength(2);
  });

  it("emits a nextCursor when more results remain", async () => {
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20 },
      deps(page({ bookIds: [1, 2], total: 5 })),
    );
    expect(r.structuredContent?.nextCursor).toBeTypeOf("string");
  });

  it("omits nextCursor on the last page", async () => {
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20 },
      deps(page({ bookIds: [1, 2], total: 2 })),
    );
    expect(r.structuredContent?.nextCursor).toBeUndefined();
  });

  it("returns a zero-result sentinel without error", async () => {
    const r = await searchTool.handler(
      { query: "zzz", mode: "meta", scope: "library", limit: 20 },
      deps(page({ bookIds: [], total: 0 })),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ total: 0, count: 0 });
  });
});
