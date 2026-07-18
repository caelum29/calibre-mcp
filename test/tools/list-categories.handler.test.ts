import { describe, it, expect } from "vitest";
import { listCategoriesTool } from "../../src/tools/calibre_list_categories.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Category, CategoryItemsPage } from "../../src/domain/library.js";
import type { ToolDeps } from "../../src/tools/types.js";

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
