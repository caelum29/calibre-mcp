import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/types.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 1,
  uuid: "u",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: ["en"],
  ...over,
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
      bookIds: fixture.map((b) => b.id),
      total: fixture.length,
      num: fixture.length,
      offset: 0,
      sort: "title",
      libraryId: "Lib",
    }),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {
      calibredb: opts.calibredb ?? (async () => ({ stdout: "", stderr: "" })),
    } as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
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

  it("previews a previously-empty field with before: null (outputSchema-valid)", async () => {
    const r = await bulkUpdateTool.handler({ changes: { publisher: "Acme" }, ids: [1], preview: true }, deps());
    const books = r.structuredContent?.books as { changed: unknown[] }[];
    expect(books[0]!.changed).toEqual([{ field: "publisher", before: null, after: "Acme" }]);
    const schema = z.object(bulkUpdateTool.outputSchema!);
    expect(schema.safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success).toBe(true);
  });

  it("requires a book set (no ids and no query)", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await bulkUpdateTool.handler({ changes: { tags: ["new"] }, preview: false }, deps({ calibredb: spy }));
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
    expect(spy).toHaveBeenNthCalledWith(
      1,
      ["set_metadata", "1", "--field", "tags:new"],
      expect.objectContaining({ library: "Programming_Books" }),
    );
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
    expect(failed[0]?.id).toBe(1);
    expect(failed[0]?.error).toContain("calibre_get_book id=1");
  });
});

// issue #213 — a write refusal mid-loop must not hide books that already committed
describe("calibre_bulk_update mid-loop write refusal (#213)", () => {
  const refusal = (): never => {
    throw new CalibreCliError(1, "boom", "HTTP Error 403: Forbidden");
  };
  /** calibredb fake: answers call N with outcomes[N-1] (default: success). */
  const scripted = (outcomes: (null | (() => never))[]) => {
    const spy = vi.fn(async () => {
      const outcome = outcomes[spy.mock.calls.length - 1];
      if (outcome) outcome();
      return { stdout: "", stderr: "" };
    });
    return spy;
  };
  const three = [book({ id: 1 }), book({ id: 2 }), book({ id: 3 })];
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

  it("keeps the committed book visible when book 2 of 3 is refused, and stops writing", async () => {
    const spy = scripted([null, refusal]);
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3], preview: false },
      deps({ fixture: three, calibredb: spy }),
    );
    expect(r.isError).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.structuredContent?.applied).toEqual([1]);
    expect((r.structuredContent?.failed as { id: number }[] | undefined)?.map((f) => f.id)).toEqual([2]);
    expect(r.structuredContent?.notAttempted).toEqual([3]);
    expect(text(r)).toContain("Committed (do NOT retry these): 1.");
    expect(text(r)).toContain("Not attempted: 3.");
    expect(text(r)).toContain("--enable-local-write");
  });

  it("returns an outputSchema-valid partial result", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3], preview: false },
      deps({ fixture: three, calibredb: scripted([null, refusal]) }),
    );
    const schema = z.object(bulkUpdateTool.outputSchema!);
    expect(schema.safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success).toBe(true);
  });

  it("omits the not-attempted line when the refusal hits the last book", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({ fixture: [book({ id: 1 }), book({ id: 2 })], calibredb: scripted([null, refusal]) }),
    );
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.applied).toEqual([1]);
    expect(r.structuredContent?.notAttempted).toEqual([]);
    expect(text(r)).toContain("Committed (do NOT retry these): 1.");
    expect(text(r)).not.toContain("Not attempted");
  });

  it("counts a timed-out-but-landed book as committed when the next book is refused", async () => {
    const timeout = (): never => {
      throw new CalibreCliTimeoutError("calibredb command timed out");
    };
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({
        fixture: [book({ id: 1 }), book({ id: 2 })],
        calibredb: scripted([timeout, refusal]),
        getBook: async (id) => book({ id, tags: ["new"] }),
      }),
    );
    expect(r.structuredContent?.applied).toEqual([1]);
    expect(text(r)).toContain("Committed (do NOT retry these): 1.");
  });

  it("keeps the bare refusal error when the very first book is refused (nothing committed)", async () => {
    const spy = scripted([refusal]);
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3], preview: false },
      deps({ fixture: three, calibredb: spy }),
    );
    expect(r.isError).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(text(r)).toContain("--enable-local-write");
    expect(text(r)).not.toContain("Committed");
  });
});
