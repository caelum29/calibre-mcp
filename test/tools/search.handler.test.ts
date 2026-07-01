import { describe, it, expect } from "vitest";
import { searchTool } from "../../src/tools/calibre_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { FtsHit, SearchPage } from "../../src/domain/search.js";
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

interface FakeOpts {
  page?: SearchPage;
  ftsHits?: FtsHit[];
}

// Fake deps with only the methods each branch touches (boundary stub).
function deps(opts: FakeOpts = {}): ToolDeps {
  const content = {
    search: async (p: { query: string }): Promise<SearchPage> => {
      if (p.query.startsWith("uuid:")) return { ...page(), bookIds: [99] };
      return opts.page ?? page();
    },
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)])),
    // FTS paths resolve the libId before shelling out (display-name fragments 404).
    resolveLibraryId: async (display?: string) => display || "Programming_Books",
  };
  const calibre = {
    ftsSearch: async (): Promise<FtsHit[]> => opts.ftsHits ?? [],
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: calibre as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
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

describe("calibre_search handler — meta/library", () => {
  it("returns one resource_link per hit plus a summary line", async () => {
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20 },
      deps({ page: page() }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.content.filter((c) => c.type === "resource_link")).toHaveLength(2);
  });

  it("emits a nextCursor when more results remain", async () => {
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20 },
      deps({ page: page({ bookIds: [1, 2], total: 5 }) }),
    );
    expect(r.structuredContent?.nextCursor).toBeTypeOf("string");
  });

  it("omits nextCursor on the last page", async () => {
    const r = await searchTool.handler(
      { query: "rust", mode: "meta", scope: "library", limit: 20 },
      deps({ page: page({ bookIds: [1, 2], total: 2 }) }),
    );
    expect(r.structuredContent?.nextCursor).toBeUndefined();
  });

  it("returns a zero-result sentinel without error", async () => {
    const r = await searchTool.handler(
      { query: "zzz", mode: "meta", scope: "library", limit: 20 },
      deps({ page: page({ bookIds: [], total: 0 }) }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ total: 0, count: 0 });
  });
});

describe("calibre_search handler — fts/library", () => {
  it("groups hits by book into resource_links + fenced snippets", async () => {
    const hits: FtsHit[] = [
      { bookId: 1, snippet: "match one" },
      { bookId: 1, snippet: "match two" },
      { bookId: 2, snippet: "match three" },
    ];
    const r = await searchTool.handler(
      { query: "rust", mode: "fts", scope: "library", limit: 20 },
      deps({ ftsHits: hits }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.content.filter((c) => c.type === "resource_link")).toHaveLength(2);
    const fenced = r.content.filter((c) => c.type === "text" && c.text.includes("FTS SNIPPET"));
    expect(fenced.length).toBeGreaterThan(0);
    expect(r.structuredContent?.mode).toBe("fts");
  });

  it("returns a zero-result message when fts has no hits", async () => {
    const r = await searchTool.handler(
      { query: "zzz", mode: "fts", scope: "library", limit: 20 },
      deps({ ftsHits: [] }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ total: 0 });
  });
});

describe("calibre_search handler — scope=book", () => {
  it("requires bookId", async () => {
    const r = await searchTool.handler({ query: "x", mode: "fts", scope: "book", limit: 20 }, deps());
    expect(r.isError).toBe(true);
    expect(r.content[0]).toMatchObject({ type: "text" });
  });

  it("returns fenced in-book snippets when given a bookId", async () => {
    const r = await searchTool.handler(
      { query: "ownership", mode: "fts", scope: "book", bookId: 1, limit: 20 },
      deps({ ftsHits: [{ bookId: 1, snippet: "…ownership…" }] }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ scope: "book", bookId: 1, total: 1 });
  });
});
