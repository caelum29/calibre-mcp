// #305: every page cursor is bound to {v, libId, mode, query}. Reusing one with another
// library (incl. `library` omitted = the default library), mode or query, or passing a
// pre-upgrade `{offset, query}` cursor, returns an actionable error — never a silent restart
// at 0 and never the old offset applied to a different result set.
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
import type { SearchDeps, SearchIndex } from "../../src/tools/calibre_search.js";
import type { ToolResult } from "../../src/tools/types.js";
import { fakeFts } from "./fake-fts.js";

// Two libraries: "Humanities" by name, anything else (incl. omitted) is the default.
const resolveLibraryId = async (d?: string) => (d === "Humanities" ? "Humanities" : "Programming_Books");

// Dirty books (no ISBN/tags/…) in duplicate pairs: enough quality issues and dup groups to page.
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
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve"];

// Boundary stub of the Content Server; every library serves the same fixture.
function deps(): SearchDeps {
  const byId = new Map(BOOKS.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId,
    search: async (p: { num?: number; offset?: number; library?: string }) => {
      const offset = p.offset ?? 0;
      const num = p.num ?? BOOKS.length;
      return {
        bookIds: BOOKS.slice(offset, offset + num).map((b) => b.id),
        total: BOOKS.length,
        num,
        offset,
        sort: "title",
        libraryId: await resolveLibraryId(p.library),
      };
    },
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
    categories: async (): Promise<Category[]> => [{ name: "Tags", url: "/ajax/category/ttt/Lib" }],
    categoryItemsByUrl: async (_u: string, p: { num: number; offset: number }): Promise<CategoryItemsPage> => ({
      items: NAMES.slice(p.offset, p.offset + p.num).map((name) => ({ name, count: 1 })),
      total: NAMES.length,
      offset: p.offset,
      num: p.num,
    }),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    fts: fakeFts(BOOKS.map((b) => ({ bookId: b.id, snippet: `s${b.id} >>rust<<` }))),
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false, isBookIndexed: () => false } satisfies SearchIndex,
    log,
  };
}

type Args = Record<string, unknown>;
interface Case {
  tool: string;
  run: (a: Args) => Promise<ToolResult>;
  base: Args;
}
const CASES: Case[] = [
  {
    tool: "calibre_search mode=meta",
    run: (a) => searchTool.handler({ query: "rust", mode: "meta", scope: "library", limit: 2, ...a } as never, deps()),
    base: {},
  },
  {
    tool: "calibre_search mode=fts",
    run: (a) => searchTool.handler({ query: "rust", mode: "fts", scope: "library", limit: 2, ...a } as never, deps()),
    base: {},
  },
  {
    tool: "calibre_list_categories",
    run: (a) => listCategoriesTool.handler({ field: "tags", limit: 2, ...a } as never, deps()),
    base: {},
  },
  {
    tool: "calibre_quality_report",
    run: (a) => qualityReportTool.handler({ limit: 2, ...a } as never, deps()),
    base: {},
  },
  {
    tool: "calibre_find_duplicates",
    run: (a) => findDuplicatesTool.handler({ mode: "identical", limit: 2, ...a } as never, deps()),
    base: {},
  },
];

const textOf = (r: ToolResult): string => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
const offsetOf = (r: ToolResult): unknown => r.structuredContent?.offset;

async function mint(c: Case, library?: string): Promise<string> {
  const first = await c.run(library === undefined ? {} : { library });
  const cursor = first.structuredContent?.nextCursor;
  if (typeof cursor !== "string") throw new Error(`${c.tool}: no nextCursor on page 1`);
  return cursor;
}

describe.each(CASES)("$tool cursor binding (#305)", (c) => {
  it("should_continue_from_the_cursor_offset_in_the_same_library", async () => {
    const cursor = await mint(c, "Humanities");
    const r = await c.run({ library: "Humanities", cursor });
    expect(r.isError).toBeFalsy();
    expect(offsetOf(r)).toBe(2);
  });

  it("should_refuse_a_cursor_from_library_X_reused_with_library_Y", async () => {
    const cursor = await mint(c, "Humanities");
    const r = await c.run({ library: "Programming_Books", cursor });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('cursor is for library "Humanities"');
  });

  it("should_refuse_a_cursor_from_library_X_reused_with_library_omitted", async () => {
    const cursor = await mint(c, "Humanities");
    const r = await c.run({ cursor });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('cursor is for library "Humanities"');
  });

  it("should_tell_the_model_how_to_recover_from_a_library_mismatch", async () => {
    const cursor = await mint(c, "Humanities");
    const r = await c.run({ cursor });
    expect(textOf(r)).toContain("without cursor");
  });

  it("should_refuse_a_pre_upgrade_offset_query_cursor_with_an_actionable_error", async () => {
    const old = Buffer.from(JSON.stringify({ offset: 2, query: "rust" }), "utf8").toString("base64url");
    const r = await c.run({ cursor: old });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Invalid cursor");
  });

  it("should_return_an_error_result_not_throw_on_a_garbage_cursor", async () => {
    const r = await c.run({ cursor: "%%%not-a-cursor" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("without cursor");
  });
});

describe("calibre_search cursor binding — mode and query (#305)", () => {
  const meta = CASES[0]!;
  const fts = CASES[1]!;

  it("should_refuse_a_meta_cursor_reused_in_fts_mode", async () => {
    const cursor = await mint(meta);
    const r = await fts.run({ cursor });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("different mode");
  });

  it("should_refuse_a_cursor_reused_with_another_query", async () => {
    const cursor = await mint(meta);
    const r = await meta.run({ query: "golang", cursor });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("different query");
  });
});
