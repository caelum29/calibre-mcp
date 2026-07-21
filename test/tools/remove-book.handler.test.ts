import { describe, it, expect, vi } from "vitest";
import { removeBookTool } from "../../src/tools/calibre_remove_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ToolDeps } from "../../src/tools/types.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 1, uuid: "u", title: "Doomed", authors: ["A"], identifiers: {}, formats: ["pdf"],
  tags: [], languages: [], ...over,
});

function deps(calibredb: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>): ToolDeps {
  const byId = new Map([1, 2].map((id) => [id, book({ id, title: `Book ${id}` })] as const));
  const content = {
    resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books",
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    log,
  };
}

describe("calibre_remove_book handler", () => {
  it("dry-runs without confirm and does not call calibredb", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [1, 2] }, deps(spy));
    // The gate working is a success, not an error — isError here makes agents refuse confirm.
    expect(r.isError).toBeFalsy();
    expect(spy).not.toHaveBeenCalled();
    expect(r.structuredContent?.deleted).toBe(false);
    expect((r.structuredContent?.wouldRemove as unknown[]).length).toBe(2);
  });

  it("removes with a comma-separated id list when confirmed", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [1, 2], confirm: true }, deps(spy));
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledWith(
      ["remove", "1,2"],
      expect.objectContaining({ library: "Programming_Books" }),
    );
    expect(r.structuredContent?.removedIds).toEqual([1, 2]);
  });

  it("requires at least one id", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [], confirm: true }, deps(spy));
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
