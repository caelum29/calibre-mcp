import { describe, it, expect, vi } from "vitest";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/types.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 1, uuid: "u", title: "T", authors: ["A"], identifiers: {}, formats: ["pdf"],
  tags: ["old"], languages: ["en"], ...over,
});

interface FakeOpts {
  fixture?: Book[];
  calibredb?: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  /** Re-read used to verify a timed-out write; defaults to the unchanged fixture book. */
  getBook?: (id: number) => Promise<Book>;
}

function deps(opts: FakeOpts = {}): ToolDeps {
  const fixture = opts.fixture ?? [book({ id: 1 }), book({ id: 2 })];
  const byId = new Map(fixture.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books",
    getBook: opts.getBook ?? (async (id: number): Promise<Book> => byId.get(id) ?? book({ id })),
    search: async () => ({
      bookIds: fixture.map((b) => b.id), total: fixture.length,
      num: fixture.length, offset: 0, sort: "title", libraryId: "Lib",
    }),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb: opts.calibredb ?? (async () => ({ stdout: "", stderr: "" })) } as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    log,
  };
}

describe("calibre_bulk_update handler", () => {
  it("previews diffs by default without calling calibredb", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: true },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBeFalsy();
    expect(spy).not.toHaveBeenCalled();
    expect(r.structuredContent?.preview).toBe(true);
    expect(r.structuredContent?.matched).toBe(2);
  });

  it("requires a book set (no ids and no query)", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, preview: false },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("applies set_metadata per book with the resolved libId", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1,
      ["set_metadata", "1", "--field", "tags:new"],
      expect.objectContaining({ library: "Programming_Books" }));
    expect(r.structuredContent?.applied).toEqual([1, 2]);
  });

  it("rejects unknown fields before writing", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await bulkUpdateTool.handler(
      { changes: { evil: "x" }, ids: [1], preview: false },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("errors when the selection matches no books", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, query: "nomatch", preview: false },
      deps({ fixture: [] }),
    );
    expect(r.isError).toBe(true);
  });

  // issue #33 — a timed-out routed write may have committed server-side

  it("counts a timed-out write as applied when a re-read confirms it landed", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], preview: false },
      deps({
        fixture: [book({ id: 1 })],
        calibredb: async () => {
          throw new CalibreCliTimeoutError("calibredb command timed out");
        },
        getBook: async () => book({ id: 1, tags: ["new"] }),
      }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.applied).toEqual([1]);
    expect(r.structuredContent?.failed).toEqual([]);
  });

  it("reports a timed-out write as failed with a verify hint when the re-read does not confirm", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], preview: false },
      deps({
        fixture: [book({ id: 1 })],
        calibredb: async () => {
          throw new CalibreCliTimeoutError("calibredb command timed out");
        },
      }),
    );
    expect(r.structuredContent?.applied).toEqual([]);
    const failed = r.structuredContent?.failed as { id: number; error: string }[];
    expect(failed[0].id).toBe(1);
    expect(failed[0].error).toContain("calibre_get_book id=1");
  });
});
