import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError, CalibreHttpError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";

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
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
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

  it("sets a previously-empty field without failing the outputSchema", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { publisher: "Acme" } },
      deps({ books: [book(), book({ publisher: "Acme" })] }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.changed).toEqual([{ field: "publisher", before: null, after: "Acme" }]);
    // the committed write must survive the SDK's outputSchema validation
    const schema = z.object(updateBookTool.outputSchema!);
    expect(schema.safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success).toBe(true);
  });

  it("detects a no-op when before equals after", async () => {
    const r = await updateBookTool.handler({ id: 658, changes: { tags: ["old"] } }, deps({ books: [book(), book()] }));
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
    const r = await updateBookTool.handler({ id: 658, changes: { publisher: "MIT Press" } }, deps({ getBook }));
    expect(r.isError).toBeFalsy();
    expect((r.content[0] as { text: string }).text).toContain("Updated book 658");
    // diff falls back to the intended value when the re-read is unavailable
    expect(r.structuredContent?.changed).toEqual([{ field: "publisher", before: null, after: "MIT Press" }]);
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

// issue #202 — `changed` lists only fields whose value actually differs
describe("calibre_update_book phantom diffs (#202)", () => {
  it("drops an unchanged authors field and keeps the real change", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { title: "New", authors: ["Jonathan Baier"] } },
      deps({
        books: [
          book({ title: "Old", authors: ["Jonathan Baier"] }),
          book({ title: "New", authors: ["Jonathan Baier"] }),
        ],
      }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.changed).toEqual([{ field: "title", before: "Old", after: "New" }]);
    expect(r.structuredContent?.noop).toBe(false);
  });

  it("treats identifiers with the same entries in a different key order as unchanged", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { identifiers: { isbn: "9781937538859", asin: "B0X" } } },
      deps({
        books: [
          book({ identifiers: { isbn: "9781937538859", asin: "B0X" } }),
          book({ identifiers: { asin: "B0X", isbn: "9781937538859" } }),
        ],
      }),
    );
    expect(r.structuredContent?.changed).toEqual([]);
    expect(r.structuredContent?.noop).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("No changes applied to book 658");
  });

  it("keeps a reordered authors list as a change (author order is significant)", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { authors: ["B", "A"] } },
      deps({ books: [book({ authors: ["A", "B"] }), book({ authors: ["B", "A"] })] }),
    );
    expect(r.structuredContent?.changed).toEqual([{ field: "authors", before: ["A", "B"], after: ["B", "A"] }]);
    expect(r.structuredContent?.noop).toBe(false);
  });

  it("reports changed: [] with noop when every requested field is already current", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: ["old"], authors: ["A"] } },
      deps({ books: [book(), book()] }),
    );
    expect(r.structuredContent?.changed).toEqual([]);
    expect(r.structuredContent?.noop).toBe(true);
  });

  it("drops already-current fields from the intended-value diff when the re-read fails", async () => {
    let calls = 0;
    const getBook = async (): Promise<Book> => {
      calls += 1;
      if (calls > 1) throw new CalibreHttpError(0, "u", "Content Server request timed out");
      return book({ authors: ["Jonathan Baier"] });
    };
    const r = await updateBookTool.handler(
      { id: 658, changes: { publisher: "MIT Press", authors: ["Jonathan Baier"] } },
      deps({ getBook }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.changed).toEqual([{ field: "publisher", before: null, after: "MIT Press" }]);
  });
});

// issue #216 — the before/after diff must reach clients that only show text content
describe("calibre_update_book diff in text (#216)", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

  it("renders the changed title as before → after in the text", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { title: "New Title" } },
      deps({ books: [book({ title: "Old Title" }), book({ title: "New Title" })] }),
    );
    expect(text(r)).toContain('title: "Old Title" → "New Title"');
  });

  it("renders a previously-empty field as null → value", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { publisher: "Acme" } },
      deps({ books: [book(), book({ publisher: "Acme" })] }),
    );
    expect(text(r)).toContain('publisher: null → "Acme"');
  });

  it("renders list fields as JSON arrays", async () => {
    const r = await updateBookTool.handler({ id: 658, changes: { tags: ["new"] } }, deps());
    expect(text(r)).toContain('tags: ["old"] → ["new"]');
  });

  it("does not render fields that did not change", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { title: "New", authors: ["A"] } },
      deps({ books: [book(), book({ title: "New" })] }),
    );
    expect(text(r)).toContain('title: "Old" → "New"');
    expect(text(r)).not.toContain("authors:");
  });

  it("truncates long values so a big comments field cannot flood the text", async () => {
    const longBefore = "a".repeat(5000);
    const longAfter = "b".repeat(5000);
    const r = await updateBookTool.handler(
      { id: 658, changes: { comments: longAfter } },
      deps({ books: [book({ comments: longBefore }), book({ comments: longAfter })] }),
    );
    expect(text(r)).toContain("comments: ");
    expect(text(r)).toContain("…");
    expect(text(r).length).toBeLessThan(1000);
  });

  it("renders no diff lines for a no-op update", async () => {
    const r = await updateBookTool.handler({ id: 658, changes: { tags: ["old"] } }, deps({ books: [book(), book()] }));
    expect(text(r)).toContain("No changes applied to book 658");
    expect(text(r)).not.toContain("→");
  });

  it("renders the intended-value diff when the verification re-read fails", async () => {
    let calls = 0;
    const getBook = async (): Promise<Book> => {
      calls += 1;
      if (calls > 1) throw new CalibreHttpError(0, "u", "Content Server request timed out");
      return book();
    };
    const r = await updateBookTool.handler({ id: 658, changes: { publisher: "MIT Press" } }, deps({ getBook }));
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('publisher: null → "MIT Press"');
  });

  it("renders the diff when a timed-out write is confirmed by the re-read", async () => {
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
    expect(text(r)).toContain('tags: ["old"] → ["new"]');
  });
});

describe("calibre_update_book text details", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
  const failingReread = (first: Book) => {
    let calls = 0;
    return async (): Promise<Book> => {
      calls += 1;
      if (calls > 1) throw new CalibreHttpError(0, "u", "Content Server request timed out");
      return first;
    };
  };

  it("says the diff is unverified when the post-write re-read fails", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { publisher: "MIT Press" } },
      deps({ getBook: failingReread(book()) }),
    );
    expect(text(r)).toContain("the verification re-read failed");
  });

  it("flags noop when the re-read fails and every requested value was already current", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: ["old"] } },
      deps({ getBook: failingReread(book()) }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.noop).toBe(true);
  });

  it("does not flag noop when the re-read fails but a value was going to change", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: ["new"] } },
      deps({ getBook: failingReread(book()) }),
    );
    expect(r.structuredContent?.noop).toBe(false);
  });

  it("answers a no-op update with only the one-line summary", async () => {
    const r = await updateBookTool.handler({ id: 658, changes: { tags: ["old"] } }, deps({ books: [book(), book()] }));
    expect(text(r)).toBe("No changes applied to book 658 (values already current).");
  });

  it("puts each changed field on its own line", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { title: "New", tags: ["new"] } },
      deps({ books: [book(), book({ title: "New", tags: ["new"] })] }),
    );
    expect(text(r)).toContain("Updated book 658: title, tags.\n");
    expect(text(r)).toContain('title: "Old" → "New"\ntags: ["old"] → ["new"]');
  });

  it("shows a value of exactly 120 rendered chars in full", async () => {
    const at = "x".repeat(118); // 120 chars once JSON-quoted
    const r = await updateBookTool.handler(
      { id: 658, changes: { publisher: at } },
      deps({ books: [book(), book({ publisher: at })] }),
    );
    expect(text(r)).toContain(`publisher: null → "${at}"\n`);
  });

  it("cuts a longer value to 120 rendered chars ending in an ellipsis", async () => {
    const over = "x".repeat(119); // 121 chars once JSON-quoted
    const r = await updateBookTool.handler(
      { id: 658, changes: { publisher: over } },
      deps({ books: [book(), book({ publisher: over })] }),
    );
    expect(text(r)).toContain(`publisher: null → "${"x".repeat(118)}…\n`);
  });
});

// review round 1 — empty and absent values are the same "nothing" (#202)
describe("calibre_update_book empty vs absent (#202)", () => {
  it("reports no change when clearing comments on a book that has none", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { comments: "" } },
      deps({ books: [book(), book({ comments: "" })] }),
    );
    expect(r.structuredContent?.changed).toEqual([]);
    expect(r.structuredContent?.noop).toBe(true);
  });

  it("reports no change when clearing identifiers that read back absent", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { identifiers: {} } },
      deps({ books: [book({ identifiers: undefined as unknown as Book["identifiers"] }), book()] }),
    );
    expect(r.structuredContent?.changed).toEqual([]);
  });

  it("drops a clear-to-empty of an absent field from the intended diff when the re-read fails", async () => {
    let calls = 0;
    const getBook = async (): Promise<Book> => {
      calls += 1;
      if (calls > 1) throw new CalibreHttpError(0, "u", "Content Server request timed out");
      return book();
    };
    const r = await updateBookTool.handler({ id: 658, changes: { publisher: "", tags: ["new"] } }, deps({ getBook }));
    expect(r.structuredContent?.changed).toEqual([{ field: "tags", before: ["old"], after: ["new"] }]);
  });

  it("still reports clearing a non-empty field as a change", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { tags: [] } },
      deps({ books: [book({ tags: ["old"] }), book({ tags: [] })] }),
    );
    expect(r.structuredContent?.changed).toEqual([{ field: "tags", before: ["old"], after: [] }]);
  });
});

// review round 1 — the unverified-noop text must agree with structuredContent (#216)
describe("calibre_update_book unverified no-op text (#216)", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
  const failingReread = async (): Promise<Book> => {
    throw new CalibreHttpError(0, "u", "Content Server request timed out");
  };

  it("says nothing changed, not 'Updated', when every value was already current", async () => {
    let first = true;
    const getBook = async (): Promise<Book> => {
      if (first) {
        first = false;
        return book();
      }
      return failingReread();
    };
    const r = await updateBookTool.handler({ id: 658, changes: { tags: ["old"] } }, deps({ getBook }));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.noop).toBe(true);
    expect(text(r)).toContain("No changes applied to book 658");
    expect(text(r)).not.toContain("Updated book");
    expect(text(r)).toContain("the verification re-read failed");
  });

  it("keeps 'Updated' when the unverified write was going to change a value", async () => {
    let first = true;
    const getBook = async (): Promise<Book> => {
      if (first) {
        first = false;
        return book();
      }
      return failingReread();
    };
    const r = await updateBookTool.handler({ id: 658, changes: { tags: ["new"] } }, deps({ getBook }));
    expect(text(r)).toContain("Updated book 658");
    expect(text(r)).not.toContain("No changes applied");
  });
});

// #235 — the summary names only fields that actually changed, matching structuredContent.changed
describe("calibre_update_book summary names changed fields only (#235)", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
  const failingReread = (first: Book) => {
    let calls = 0;
    return async (): Promise<Book> => {
      calls += 1;
      if (calls > 1) throw new CalibreHttpError(0, "u", "Content Server request timed out");
      return first;
    };
  };

  it("should_name_only_title_when_tags_were_already_current", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { title: "New", tags: ["old"] } },
      deps({ books: [book(), book({ title: "New" })] }),
    );
    expect(text(r)).toContain("Updated book 658: title.\n");
  });

  it("should_name_only_the_changing_field_when_the_reread_fails", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { title: "New", tags: ["old"] } },
      deps({ getBook: failingReread(book()) }),
    );
    expect(text(r)).toContain("Updated book 658: title. (diff shows intended values");
  });
});
