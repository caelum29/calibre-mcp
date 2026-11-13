// #584: a confirmed calibre_remove_book whose `calibredb remove` times out or drops mid-request
// may still have committed, so the tool re-reads the ids instead of reporting a plain failure.

import { describe, it, expect, vi } from "vitest";
import { removeBookTool } from "../../src/tools/calibre_remove_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError, CalibreHttpError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const LIB = "Programming_Books";

const book = (id: number): Book => ({
  id,
  uuid: `u${id}`,
  title: `Book ${id}`,
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
});

/** What `getBook` answers after the failed remove: the id is gone (404), still there, or the read fails. */
type After = "gone" | "present" | "error";

function setup(err: Error, after: Record<number, After>) {
  const calibredb = vi.fn(async () => {
    throw err;
  });
  const deleteBooks = vi.fn(() => ({ books: 0, chunks: 0, figures: 0 }));
  const content = {
    resolveLibraryId: async (): Promise<string> => LIB,
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)] as const)),
    getBook: async (id: number): Promise<Book> => {
      const state = after[id];
      if (state === "present") return book(id);
      if (state === "gone") throw new CalibreHttpError(404, `http://localhost:8080/ajax/book/${id}`, "Not Found");
      throw new CalibreHttpError(500, `http://localhost:8080/ajax/book/${id}`, "Internal Server Error");
    },
  };
  const deps = {
    config: loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "1" }),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { deleteBooks },
    log,
  };
  return { deps, calibredb, deleteBooks };
}

const text = (r: ToolResult): string => (r.content[0] as { text: string }).text;
const timeout = () => new CalibreCliTimeoutError("calibredb timed out after 60000 ms");
const dropped = () => new CalibreCliError(1, "calibredb failed", "ConnectionResetError: Connection reset by peer");

describe("calibre_remove_book after a timed-out or dropped calibredb remove (#584)", () => {
  it("timeout + every id gone on re-read = success, index pruned, no retry", async () => {
    const { deps, calibredb, deleteBooks } = setup(timeout(), { 1: "gone", 2: "gone" });
    const r = await removeBookTool.handler({ ids: [1, 2], confirm: true }, deps);

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.deleted).toBe(true);
    expect(r.structuredContent?.removedIds).toEqual([1, 2]);
    expect(text(r)).toContain("Removed 2 book(s): 1, 2.");
    expect(text(r)).toContain("Confirmed by a re-read after calibredb timed out.");
    // timeouts never retry
    expect(calibredb).toHaveBeenCalledTimes(1);
    expect(deleteBooks).toHaveBeenCalledWith(LIB, [1, 2], { noWait: true });
  });

  it("dropped connection + every id gone on re-read = success with the drop note", async () => {
    const { deps, deleteBooks } = setup(dropped(), { 7: "gone" });
    const r = await removeBookTool.handler({ ids: [7], confirm: true }, deps);

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.removedIds).toEqual([7]);
    expect(text(r)).toContain("Confirmed by a re-read after the connection dropped mid-request.");
    expect(deleteBooks).toHaveBeenCalledWith(LIB, [7], { noWait: true });
  });

  it("timeout + one id still present = write_unverified naming what is left; the gone id is pruned", async () => {
    const { deps, deleteBooks } = setup(timeout(), { 1: "gone", 2: "present" });
    const r = await removeBookTool.handler({ ids: [1, 2], confirm: true }, deps);

    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe("write_unverified");
    expect(text(r)).toContain("calibredb timed out");
    expect(text(r)).toContain("#2 still exists");
    expect(text(r)).toContain("#1 already in the Trash");
    expect(text(r)).toContain("calibre_get_book id=2");
    expect(text(r)).toContain("ids=[2]");
    expect(deleteBooks).toHaveBeenCalledTimes(1);
    expect(deleteBooks).toHaveBeenCalledWith(LIB, [1], { noWait: true });
  });

  it("timeout + a failed re-read = write_unverified steering to calibre_get_book; only the confirmed-gone id is pruned", async () => {
    const { deps, deleteBooks } = setup(timeout(), { 3: "error", 4: "gone" });
    const r = await removeBookTool.handler({ ids: [3, 4], confirm: true }, deps);

    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe("write_unverified");
    expect(text(r)).toContain("calibredb timed out and the re-read does not confirm the removal of #3");
    expect(text(r)).toContain("calibre_get_book id=3");
    expect(text(r)).not.toContain("id=4");
    // #4 is confirmed gone, so the index follows it; #3 stays indexed until confirmed
    expect(deleteBooks).toHaveBeenCalledWith(LIB, [4], { noWait: true });
  });
});
