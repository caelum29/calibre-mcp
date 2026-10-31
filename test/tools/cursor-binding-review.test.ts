// PR #320 review (#305): every input that changes the paged set is bound (ids, sortOrder…), and
// a bad cursor is rejected before any expensive fetch and on every path — 0-hit FTS calls,
// list_categories without a field, find_duplicates compare mode.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { Category, CategoryItemsPage } from "../../src/domain/library.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import { listCategoriesTool } from "../../src/tools/calibre_list_categories.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import { findDuplicatesTool } from "../../src/tools/calibre_find_duplicates.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";
import { fakeFts } from "./fake-fts.js";

// Dirty books in same-title pairs: every book has quality issues, ids 2k-1/2k form a dup group.
const BOOKS: Book[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  uuid: `u${i + 1}`,
  title: `Title ${Math.floor(i / 2)}`,
  authors: ["X"],
  identifiers: {},
  formats: [],
  tags: [],
  languages: [],
}));

interface Fake {
  deps: ToolDeps;
  /** Book-selection fetches (search + booksByIds) — the expensive part a bad cursor must skip. */
  fetches: () => number;
}

// Boundary stub of the Content Server with call counters.
function fake(opts: { ftsHits?: number } = {}): Fake {
  let fetches = 0;
  const byId = new Map(BOOKS.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async () => "Programming_Books",
    search: async (p: { num?: number; offset?: number }) => {
      fetches++;
      const offset = p.offset ?? 0;
      const num = p.num ?? BOOKS.length;
      const ids = BOOKS.slice(offset, offset + num).map((b) => b.id);
      return { bookIds: ids, total: BOOKS.length, num, offset, sort: "title", libraryId: "Programming_Books" };
    },
    booksByIds: async (ids: number[]) => {
      fetches++;
      return new Map(ids.map((id) => [id, byId.get(id) ?? null] as const));
    },
    categories: async (): Promise<Category[]> => [{ name: "Tags", url: "/ajax/category/ttt/Lib" }],
    categoryItemsByUrl: async (_u: string, p: { num: number; offset: number }): Promise<CategoryItemsPage> => ({
      items: ["a", "b", "c", "d"].slice(p.offset, p.offset + p.num).map((name) => ({ name, count: 1 })),
      total: 4,
      offset: p.offset,
      num: p.num,
    }),
  };
  const hits = BOOKS.slice(0, opts.ftsHits ?? BOOKS.length).map((b) => ({ bookId: b.id, snippet: "s" }));
  return {
    fetches: () => fetches,
    deps: {
      config: loadConfig({}),
      content: content as unknown as ToolDeps["content"],
      calibre: {} as ToolDeps["calibre"],
      fts: fakeFts(hits),
      extractor: {} as ToolDeps["extractor"],
      figures: {} as ToolDeps["figures"],
      embedder: {} as ToolDeps["embedder"],
      index: { hasIndex: () => false } as unknown as ToolDeps["index"],
      log,
    },
  };
}

type Args = Record<string, unknown>;
const quality = (a: Args, f = fake()) => qualityReportTool.handler({ limit: 2, ...a } as never, f.deps);
const dupes = (a: Args, f = fake()) =>
  findDuplicatesTool.handler({ mode: "identical", limit: 2, ...a } as never, f.deps);
const meta = (a: Args, f = fake()) =>
  searchTool.handler({ query: "x", mode: "meta", scope: "library", limit: 2, ...a } as never, f.deps);
const fts = (a: Args, f = fake()) =>
  searchTool.handler({ query: "x", mode: "fts", scope: "library", limit: 2, ...a } as never, f.deps);

const textOf = (r: ToolResult): string => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
const nextOf = (r: ToolResult): string => {
  const c = r.structuredContent?.nextCursor;
  if (typeof c !== "string") throw new Error("no nextCursor on page 1");
  return c;
};
const GARBAGE = "%%%not-a-cursor";

describe("ids are bound into quality_report / find_duplicates cursors", () => {
  it("should_refuse_a_quality_cursor_reused_with_other_ids", async () => {
    const cursor = nextOf(await quality({ ids: [1, 2, 3, 4, 5, 6] }));
    const r = await quality({ ids: [3, 4, 5, 6, 7, 8], cursor });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("different query");
  });

  it("should_accept_the_same_quality_ids_in_another_order_with_duplicates", async () => {
    const cursor = nextOf(await quality({ ids: [1, 2, 3, 4, 5, 6] }));
    const r = await quality({ ids: [6, 5, 4, 3, 2, 1, 1], cursor });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.offset).toBe(2);
  });

  it("should_refuse_a_duplicates_cursor_reused_with_other_ids", async () => {
    const cursor = nextOf(await dupes({ ids: [1, 2, 3, 4, 5, 6] }));
    const r = await dupes({ ids: [3, 4, 5, 6, 7, 8], cursor });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("different query");
  });
});

describe("sortOrder is bound into calibre_search meta cursors", () => {
  it("should_refuse_an_asc_cursor_reused_with_desc", async () => {
    const cursor = nextOf(await meta({ sort: "title", sortOrder: "asc" }));
    const r = await meta({ sort: "title", sortOrder: "desc", cursor });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("different sort");
  });
});

describe("a bad cursor is rejected early and on every path", () => {
  it("should_reject_before_selecting_books_in_quality_report", async () => {
    const f = fake();
    await quality({ cursor: GARBAGE }, f);
    expect(f.fetches()).toBe(0);
  });

  it("should_reject_before_selecting_books_in_find_duplicates", async () => {
    const f = fake();
    await dupes({ cursor: GARBAGE }, f);
    expect(f.fetches()).toBe(0);
  });

  it("should_reject_a_bad_cursor_on_a_zero_hit_fts_call", async () => {
    const r = await fts({ cursor: GARBAGE }, fake({ ftsHits: 0 }));
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Invalid cursor");
  });

  it("should_reject_a_cursor_passed_to_list_categories_without_a_field", async () => {
    const f = fake();
    const cursor = nextOf(await listCategoriesTool.handler({ field: "tags", limit: 2 } as never, f.deps));
    const r = await listCategoriesTool.handler({ limit: 2, cursor } as never, f.deps);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("without cursor");
  });

  it("should_reject_a_cursor_passed_to_find_duplicates_compare_mode", async () => {
    const cursor = nextOf(await dupes({}));
    const r = await dupes({ mode: "compare", ids: [1, 2], cursor });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("different mode");
  });
});
