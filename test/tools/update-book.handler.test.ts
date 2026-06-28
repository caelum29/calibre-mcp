import { describe, it, expect, vi } from "vitest";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError } from "../../src/domain/errors.js";
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
}

function deps(opts: FakeOpts = {}): ToolDeps {
  const seq = [...(opts.books ?? [book(), book({ tags: ["new"] })])];
  const content = {
    getBook: async (): Promise<Book> => seq.shift() ?? book(),
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
      expect.objectContaining({ library: undefined }),
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
});
