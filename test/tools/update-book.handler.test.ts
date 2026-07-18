import { describe, it, expect, vi } from "vitest";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError, CalibreHttpError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/types.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 658,
  uuid: "u-658",
  title: "Old",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: [],
  ...over,
});

interface FakeOpts {
  calibredb?: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  books?: Book[]; // returned by successive getBook calls (snapshot, then after)
  getBook?: () => Promise<Book>; // overrides the seq-based fake entirely
}

function deps(opts: FakeOpts = {}): ToolDeps {
  const seq = [...(opts.books ?? [book(), book({ tags: ["new"] })])];
  const content = {
    getBook: opts.getBook ?? (async (): Promise<Book> => seq.shift() ?? book()),
    // Write path resolves display name → libId before routing calibredb.
    resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books",
  };
  const calibre = {
    calibredb: opts.calibredb ?? (async () => ({ stdout: "", stderr: "" })),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: calibre as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    log,
  };
}

describe("calibre_update_book handler", () => {
  it("builds the correct set_metadata argv", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    await updateBookTool.handler({ id: 658, changes: { tags: ["new"] } }, deps({ calibredb: spy }));
    expect(spy).toHaveBeenCalledWith(
      ["set_metadata", "658", "--field", "tags:new"],
      expect.objectContaining({ library: "Programming_Books" }),
    );
  });

  it("reports an applied diff", async () => {
    const r = await updateBookTool.handler({ id: 658, changes: { tags: ["new"] } }, deps());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.changed).toEqual([{ field: "tags", before: ["old"], after: ["new"] }]);
    expect(r.structuredContent?.noop).toBe(false);
  });

  it("detects a no-op when before equals after", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: ["old"] } },
      deps({ books: [book(), book()] }),
    );
    expect(r.structuredContent?.noop).toBe(true);
  });

  it("rejects unknown fields before writing", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await updateBookTool.handler({ id: 658, changes: { evil: "x" } }, deps({ calibredb: spy }));
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("classifies a server write-refusal into an actionable message", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: ["new"] } },
      deps({
        calibredb: async () => {
          throw new CalibreCliError(1, "calibredb command failed", "Forbidden");
        },
      }),
    );
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("--enable-local-write");
  });

  it("requires at least one field", async () => {
    const r = await updateBookTool.handler({ id: 658, changes: {} }, deps());
    expect(r.isError).toBe(true);
  });

  // issue #33 — a committed write must NEVER be reported as a failure

  it("still reports success when the post-write diff re-read fails", async () => {
    let calls = 0;
    const getBook = async (): Promise<Book> => {
      calls += 1;
      if (calls > 1) throw new CalibreHttpError(0, "u", "Content Server request timed out");
      return book();
    };
    const r = await updateBookTool.handler(
      { id: 658, changes: { publisher: "MIT Press" } },
      deps({ getBook }),
    );
    expect(r.isError).toBeFalsy();
    expect((r.content[0] as { text: string }).text).toContain("Updated book 658");
    // diff falls back to the intended value when the re-read is unavailable
    expect(r.structuredContent?.changed).toEqual([
      { field: "publisher", before: undefined, after: "MIT Press" },
    ]);
  });

  it("verifies a timed-out write via re-read and reports success when it landed", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: ["new"] } },
      deps({
        calibredb: async () => {
          throw new CalibreCliTimeoutError("calibredb command timed out");
        },
        books: [book(), book({ tags: ["new"] })],
      }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.changed).toEqual([{ field: "tags", before: ["old"], after: ["new"] }]);
  });

  it("errors with a check-first hint when a timed-out write did not land", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: ["new"] } },
      deps({
        calibredb: async () => {
          throw new CalibreCliTimeoutError("calibredb command timed out");
        },
        books: [book(), book()], // re-read still shows the old value
      }),
    );
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("calibre_get_book id=658");
  });

  it("errors cautiously when a timed-out write cannot be verified", async () => {
    let calls = 0;
    const getBook = async (): Promise<Book> => {
      calls += 1;
      if (calls > 1) throw new CalibreHttpError(0, "u", "Cannot reach Calibre Content Server");
      return book();
    };
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: ["new"] } },
      deps({
        calibredb: async () => {
          throw new CalibreCliTimeoutError("calibredb command timed out");
        },
        getBook,
      }),
    );
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("MAY have been applied");
  });
});
