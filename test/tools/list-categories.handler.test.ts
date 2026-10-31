import { describe, it, expect } from "vitest";
import { listCategoriesTool } from "../../src/tools/calibre_list_categories.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Category, CategoryItemsPage } from "../../src/domain/library.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const cats: Category[] = [
  { name: "Authors", url: "/ajax/category/aaa/Lib" },
  { name: "Tags", url: "/ajax/category/ttt/Lib" },
];
const items: CategoryItemsPage = {
  items: [
    { name: "Alice", count: 3 },
    { name: "Bob", count: 1 },
  ],
  total: 2,
  offset: 0,
  num: 2,
};

function deps(): ToolDeps {
  const content = {
    categories: async (): Promise<Category[]> => cats,
    categoryItemsByUrl: async (): Promise<CategoryItemsPage> => items,
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({ limit: 100, ...over });

describe("calibre_list_categories handler", () => {
  it("lists the category fields when no field is given", async () => {
    const r = await listCategoriesTool.handler(args(), deps());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.mode).toBe("fields");
    expect(r.structuredContent?.values).toEqual([
      { name: "Authors", count: undefined },
      { name: "Tags", count: undefined },
    ]);
  });

  it("lists a category's values for a known field", async () => {
    const r = await listCategoriesTool.handler(args({ field: "authors" }), deps());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ mode: "values", field: "Authors", total: 2 });
  });

  it("errors with the available list for an unknown field", async () => {
    const r = await listCategoriesTool.handler(args({ field: "nope" }), deps());
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("Available:");
  });

  it("filters values by a valueFilter regex", async () => {
    const r = await listCategoriesTool.handler(args({ field: "authors", valueFilter: "ali" }), deps());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ total: 1 });
    expect(r.structuredContent?.values).toEqual([{ name: "Alice", count: 3 }]);
  });

  it("accepts a valueFilter with a leading (?i) inline flag", async () => {
    const r = await listCategoriesTool.handler(args({ field: "authors", valueFilter: "(?i)ALI" }), deps());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.values).toEqual([{ name: "Alice", count: 3 }]);
  });

  it("rejects an invalid valueFilter regex", async () => {
    const r = await listCategoriesTool.handler(args({ field: "authors", valueFilter: "(" }), deps());
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("Invalid valueFilter");
  });
});

// issue #211 — the value-page cursor must reach text-only clients (Desktop), outside the fence
describe("calibre_list_categories cursor in text (#211)", () => {
  const names = ["Alice", "Bob", "Carol", "Dave", "Eve"];
  function pagedDeps(): ToolDeps {
    const d = deps();
    (d.content as unknown as Record<string, unknown>).categoryItemsByUrl = async (
      _url: string,
      p: { num: number; offset: number },
    ): Promise<CategoryItemsPage> => ({
      items: names.slice(p.offset, p.offset + p.num).map((name) => ({ name, count: 1 })),
      total: names.length,
      offset: p.offset,
      num: p.num,
    });
    return d;
  }

  it("ends with the continue-with-cursor line carrying nextCursor", async () => {
    const r = await listCategoriesTool.handler(args({ field: "tags", limit: 2 }), pagedDeps());
    const cursor = r.structuredContent?.nextCursor as string;
    expect(cursor).toBeTypeOf("string");
    expect(r.content.at(-1)).toEqual({ type: "text", text: `More results — continue with cursor: ${cursor}` });
  });

  it("has no cursor line on the last page", async () => {
    const r = await listCategoriesTool.handler(args({ field: "tags", limit: 5 }), pagedDeps());
    expect(r.structuredContent?.count).toBe(5);
    expect(JSON.stringify(r.content)).not.toContain("continue with cursor");
  });

  it("puts the cursor line on a filtered page too", async () => {
    const r = await listCategoriesTool.handler(args({ field: "tags", limit: 1, valueFilter: "a" }), pagedDeps());
    const cursor = r.structuredContent?.nextCursor as string;
    expect(cursor).toBeTypeOf("string");
    expect(r.content.at(-1)).toEqual({ type: "text", text: `More results — continue with cursor: ${cursor}` });
  });
});

// #227 — the values page stays one fenced text block (untrusted book data) ahead of the cursor
describe("calibre_list_categories values block", () => {
  it("renders the values as a fenced CATEGORY VALUES text block", async () => {
    const r = await listCategoriesTool.handler(args({ field: "authors" }), deps());
    expect(r.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("--- BEGIN UNTRUSTED CATEGORY VALUES"),
    });
  });
});
