import { describe, it, expect, vi } from "vitest";
import { removeBookTool } from "../../src/tools/calibre_remove_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 1,
  uuid: "u",
  title: "Doomed",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  ...over,
});

function deps(calibredb: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>): BaseDeps {
  const byId = new Map([1, 2].map((id) => [id, book({ id, title: `Book ${id}` })] as const));
  const content = {
    resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books",
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
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
    expect((r.structuredContent?.wouldRemove as unknown[] | undefined)?.length).toBe(2);
  });

  it("removes with a comma-separated id list when confirmed", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [1, 2], confirm: true }, deps(spy));
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledWith(["remove", "1,2"], expect.objectContaining({ library: "Programming_Books" }));
    expect(r.structuredContent?.removedIds).toEqual([1, 2]);
  });

  it("requires at least one id", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [], confirm: true }, deps(spy));
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  // #519: unknown ids must not be counted as removable books
  it("dry-run with only unknown ids is a not_found error", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [999999] }, deps(spy));
    expect(r.isError).toBe(true);
    expect(r.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("Error: None of the given ids is a book in this library: #999999."),
    });
    expect(r.structuredContent?.errorCode).toBe("not_found");
    expect(spy).not.toHaveBeenCalled();
  });

  it("dry-run with real and unknown ids counts the real ones and names the unknown ones", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [1, 999999, 2] }, deps(spy));
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toEqual({
      type: "text",
      text:
        "Dry-run — nothing removed yet. This would move 2 book(s) to Calibre's Trash " +
        "(restorable from the Calibre GUI):\n#1 Book 1\n#2 Book 2\n" +
        "Not found (skipped): #999999\n" +
        "Re-run with confirm=true to proceed.",
    });
    expect(r.structuredContent).toEqual({
      deleted: false,
      wouldRemove: [
        { id: 1, title: "Book 1" },
        { id: 2, title: "Book 2" },
      ],
      notFoundIds: [999999],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("confirm with real and unknown ids removes only the real ones and names the skipped", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [1, 999999], confirm: true }, deps(spy));
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledWith(["remove", "1"], expect.objectContaining({ library: "Programming_Books" }));
    expect(r.content[0]).toEqual({
      type: "text",
      text:
        "Removed 1 book(s): 1. They went to Calibre's Trash and can be restored from the Calibre GUI.\n" +
        "Not found (skipped): #999999",
    });
    expect(r.structuredContent).toEqual({ deleted: true, removedIds: [1], notFoundIds: [999999] });
  });

  it("confirm with only unknown ids is a not_found error and never calls calibredb", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await removeBookTool.handler({ ids: [999999], confirm: true }, deps(spy));
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe("not_found");
    expect(spy).not.toHaveBeenCalled();
  });
});
