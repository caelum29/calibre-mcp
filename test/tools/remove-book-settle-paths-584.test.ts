// #584 review: the remove re-read must only run for a timeout or a mid-request drop. A refusal, a
// transient failure that never reached the server and an unexpected error keep main's results, and
// a not-found id in the request stays out of the re-read and the re-run steer.

import { describe, it, expect, vi } from "vitest";
import { removeBookTool } from "../../src/tools/calibre_remove_book.js";
import { errorFromCatch } from "../../src/tools/result.js";
import { WRITE_REFUSED_MESSAGE } from "../../src/app/write-policy.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError, CalibreHttpError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const LIB = "Programming_Books";
/** Books the library holds; any other id is not found. */
const KNOWN = [1, 2];

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

/** `present` = ids that still read back after the failed remove; the rest 404. */
function setup(err: Error, present: number[] = []) {
  const calibredb = vi.fn(async () => {
    throw err;
  });
  const deleteBooks = vi.fn(() => ({ books: 0, chunks: 0, figures: 0 }));
  const getBook = vi.fn(async (id: number): Promise<Book> => {
    if (present.includes(id)) return book(id);
    throw new CalibreHttpError(404, `http://localhost:8080/ajax/book/${id}`, "Not Found");
  });
  const content = {
    resolveLibraryId: async (): Promise<string> => LIB,
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, KNOWN.includes(id) ? book(id) : null] as const)),
    getBook,
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
  return { deps, calibredb, deleteBooks, getBook };
}

const text = (r: ToolResult): string => (r.content[0] as { text: string }).text;

describe("calibre_remove_book: errors that are not a timeout or a drop (#584 review)", () => {
  it("a connection refused (never reached the server) renders as on main, with no re-read", async () => {
    const err = new CalibreCliError(
      1,
      "calibredb failed: connection refused",
      "ConnectionRefusedError: Connection refused",
    );
    const { deps, getBook, deleteBooks } = setup(err);
    const r = await removeBookTool.handler({ ids: [1], confirm: true }, deps);

    expect(text(r)).toBe(text(errorFromCatch(err)));
    expect(r.isError).toBe(true);
    expect(getBook).not.toHaveBeenCalled();
    expect(deleteBooks).not.toHaveBeenCalled();
  });

  it("an unexpected calibredb error renders as on main, without the skipped line, with no re-read", async () => {
    const err = new CalibreCliError(1, "calibredb failed: bad id list", "ValueError: bad id list");
    const { deps, getBook, deleteBooks } = setup(err);
    const r = await removeBookTool.handler({ ids: [1, 99], confirm: true }, deps);

    expect(text(r)).toBe(text(errorFromCatch(err)));
    expect(getBook).not.toHaveBeenCalled();
    expect(deleteBooks).not.toHaveBeenCalled();
  });

  it("a refusal stays write_refused with no re-read wording", async () => {
    const err = new CalibreCliError(1, "calibredb failed", "HTTP Error 403: Forbidden");
    const { deps, getBook, deleteBooks } = setup(err);
    const r = await removeBookTool.handler({ ids: [1, 2], confirm: true }, deps);

    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe("write_refused");
    expect(text(r)).toContain(WRITE_REFUSED_MESSAGE);
    expect(text(r)).not.toContain("re-read");
    expect(getBook).not.toHaveBeenCalled();
    expect(deleteBooks).not.toHaveBeenCalled();
  });
});

describe("calibre_remove_book: timeout with a not-found id in the request (#584 review)", () => {
  const timeout = () => new CalibreCliTimeoutError("calibredb timed out after 60000 ms");

  it("every found id gone = success naming only the removed ids, the skipped id listed apart", async () => {
    const { deps, calibredb, getBook, deleteBooks } = setup(timeout());
    const r = await removeBookTool.handler({ ids: [1, 99], confirm: true }, deps);

    expect(r.isError).toBeFalsy();
    expect(calibredb).toHaveBeenCalledWith(["remove", "1"], expect.objectContaining({ library: LIB }));
    expect(r.structuredContent?.removedIds).toEqual([1]);
    expect(r.structuredContent?.notFoundIds).toEqual([99]);
    expect(text(r)).toContain("Removed 1 book(s): 1.");
    expect(text(r)).toContain("Confirmed by a re-read after calibredb timed out.");
    expect(text(r)).toContain("Not found (skipped): #99");
    // the not-found id is never re-read nor pruned
    expect(getBook.mock.calls.map((c) => c[0])).toEqual([1]);
    expect(deleteBooks).toHaveBeenCalledWith(LIB, [1], { noWait: true });
  });

  it("partial = the re-run names only what is left, the skipped id on its own line", async () => {
    const { deps } = setup(timeout(), [2]);
    const r = await removeBookTool.handler({ ids: [1, 2, 99], confirm: true }, deps);

    expect(r.structuredContent?.errorCode).toBe("write_unverified");
    expect(text(r)).toContain("#2 still exists (#1 already in the Trash)");
    expect(text(r)).toContain("re-run with ids=[2] and confirm=true");
    expect(text(r)).toContain("\nNot found (skipped): #99");
  });
});
