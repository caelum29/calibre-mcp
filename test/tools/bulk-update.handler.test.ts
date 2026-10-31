import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "./fake-ports.js";

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

// Full-port fakes (#316): stubs for what the handler reads, the rest throw if reached.
function deps(opts: FakeOpts = {}): BaseDeps {
  const fixture = opts.fixture ?? [book({ id: 1 }), book({ id: 2 })];
  const byId = new Map(fixture.map((b) => [b.id, b] as const));
  const content = fakeContent({
    resolveLibraryId: async (name) => asLibId(name ?? "Programming_Books"),
    getBook: opts.getBook ?? (async (id: number): Promise<Book> => byId.get(id) ?? book({ id })),
    search: async () => ({
      bookIds: fixture.map((b) => b.id),
      total: fixture.length,
      num: fixture.length,
      offset: 0,
      sort: "title",
      libraryId: "Lib",
    }),
    booksByIds: async (ids) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  });
  return {
    config: loadConfig({}),
    content,
    calibre: fakeCalibre({ calibredb: opts.calibredb ?? (async () => ({ stdout: "", stderr: "" })) }),
    extractor: fakeExtractor(),
    figures: fakeFigures(),
    embedder: fakeEmbedder(),
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
    expect(text(r)).toContain("Already committed: 1.");
    expect(text(r)).toContain("Not attempted: 3.");
    expect(text(r)).toContain("--enable-local-write");
  });

  // writes are idempotent sets, so the steer is a ready re-run of what didn't land, not a ban
  it("should_hand_back_the_refused_and_unattempted_ids_as_retryIds_in_both_channels", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3], preview: false },
      deps({ fixture: three, calibredb: scripted([null, refusal]) }),
    );
    expect(r.structuredContent?.retryIds).toEqual([2, 3]);
    expect(text(r)).toContain("After fixing the server, re-run with ids=[2,3].");
  });

  it("should_retry_only_the_refused_book_when_it_was_the_last_one", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({ fixture: [book({ id: 1 }), book({ id: 2 })], calibredb: scripted([null, refusal]) }),
    );
    expect(r.structuredContent?.retryIds).toEqual([2]);
    expect(text(r)).toContain("re-run with ids=[2].");
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
    expect(text(r)).toContain("Already committed: 1.");
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
    expect(text(r)).toContain("Already committed: 1.");
  });

  // #237 — a 401 from an auth-enabled server must stop the loop exactly like a 403
  it("should_stop_the_loop_on_calibredbs_real_401_message_like_a_403", async () => {
    const unauthorized = (): never => {
      throw new CalibreCliError(1, "boom", "A username and password is required to access this server");
    };
    const spy = scripted([null, unauthorized]);
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3], preview: false },
      deps({ fixture: three, calibredb: spy }),
    );
    expect({ calls: spy.mock.calls.length, retryIds: r.structuredContent?.retryIds }).toEqual({
      calls: 2,
      retryIds: [2, 3],
    });
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

// issue #214 — ids + query must not silently drop the query
describe("calibre_bulk_update selection conflicts (#214)", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

  it("rejects ids together with a query in preview mode", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], query: "tags:foo", preview: true },
      deps(),
    );
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Pass either ids or query/filter, not both");
  });

  it("rejects ids together with a query on apply without writing", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], query: "tags:foo", preview: false },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects ids together with a filter with the same message", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], filter: "inbox", preview: true },
      deps(),
    );
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Pass either ids or query/filter, not both");
  });

  it("still accepts ids with a blank query (a blank query selects nothing)", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], query: "   ", preview: true },
      deps(),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.matched).toBe(1);
  });

  it("still accepts a query with an empty ids list", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [], query: "tags:old", preview: true },
      deps(),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.matched).toBe(2);
  });
});

// issue #216 — per-id failure reasons must reach clients that only show text content
describe("calibre_bulk_update per-id errors in text (#216)", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
  const three = [book({ id: 1 }), book({ id: 2 }), book({ id: 3 })];

  it("lists each failed id with its error when a book fails mid-way", async () => {
    let call = 0;
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3], preview: false },
      deps({
        fixture: three,
        calibredb: async () => {
          call += 1;
          if (call === 2) throw new Error("boom-2");
          return { stdout: "", stderr: "" };
        },
      }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.applied).toEqual([1, 3]);
    expect(text(r)).toContain("#2: boom-2");
    expect(text(r)).not.toContain("#1:");
    expect(text(r)).not.toContain("#3:");
  });

  it("carries the #33 verify steer for an unconfirmed timeout into the text", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], preview: false },
      deps({
        fixture: [book({ id: 1 })],
        calibredb: async () => {
          throw new CalibreCliTimeoutError("calibredb command timed out");
        },
      }),
    );
    expect(text(r)).toContain("#1: calibredb timed out");
    expect(text(r)).toContain("verify with calibre_get_book id=1 before retrying");
  });

  it("lists one line per failed id when several books fail", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({
        calibredb: async (args) => {
          throw new Error(`bad-${args[1]}`);
        },
      }),
    );
    expect(r.structuredContent?.applied).toEqual([]);
    expect(text(r)).toContain("#1: bad-1");
    expect(text(r)).toContain("#2: bad-2");
  });

  it("adds no failure lines when every book applied", async () => {
    const r = await bulkUpdateTool.handler({ changes: { tags: ["new"] }, ids: [1, 2], preview: false }, deps());
    expect(text(r)).toContain("Applied tags to 2/2 book(s).");
    expect(text(r)).not.toContain("#1:");
    expect(text(r)).not.toContain("#2:");
  });
});

describe("calibre_bulk_update result text details", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
  const refuseOnCall = (n: number) => {
    let call = 0;
    return async () => {
      call += 1;
      if (call === n) throw new CalibreCliError(1, "boom", "HTTP Error 403: Forbidden");
      return { stdout: "", stderr: "" };
    };
  };

  it("names the progress, every committed id and the refused id after a mid-loop refusal", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3], preview: false },
      deps({ fixture: [book({ id: 1 }), book({ id: 2 }), book({ id: 3 })], calibredb: refuseOnCall(3) }),
    );
    expect(text(r)).toContain("after 2/3 book(s) were already updated");
    expect(text(r)).toContain("Already committed: 1, 2.");
    expect(text(r)).toContain("Failed: 3.");
  });

  it("lists earlier failures with the refused id and every unattempted id", async () => {
    let call = 0;
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3, 4, 5], preview: false },
      deps({
        fixture: [1, 2, 3, 4, 5].map((id) => book({ id })),
        calibredb: async () => {
          call += 1;
          if (call === 2) throw new Error("boom-2");
          if (call === 3) throw new CalibreCliError(1, "boom", "HTTP Error 403: Forbidden");
          return { stdout: "", stderr: "" };
        },
      }),
    );
    expect(text(r)).toContain("Failed: 2, 3.");
    expect(text(r)).toContain("Not attempted: 4, 5.");
  });

  it("marks the partial refusal result as an applied run, not a preview", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({ calibredb: refuseOnCall(2) }),
    );
    expect(r.structuredContent?.preview).toBe(false);
  });

  it("reports a fully successful run with just the summary line", async () => {
    const r = await bulkUpdateTool.handler({ changes: { tags: ["new"] }, ids: [1, 2], preview: false }, deps());
    expect(text(r)).toBe("Applied tags to 2/2 book(s).");
  });

  it("summarizes the failure count and ids before the per-id lines", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({
        calibredb: async (args) => {
          throw new Error(`bad-${args[1]}`);
        },
      }),
    );
    expect(text(r)).toBe("Applied tags to 0/2 book(s). 2 failed: 1, 2.\n#1: bad-1\n#2: bad-2");
  });
});

// issue #227 — on a partial run the committed ids must reach text-only clients too,
// or the model can't tell which books to leave alone when it retries the failures
describe("calibre_bulk_update committed ids in text (#227)", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

  it("names the committed ids before the failures on a partial run", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2, 3], preview: false },
      deps({
        fixture: [book({ id: 1 }), book({ id: 2 }), book({ id: 3 })],
        calibredb: async (args) => {
          if (args[1] === "2") throw new Error("boom-2");
          return { stdout: "", stderr: "" };
        },
      }),
    );
    expect(text(r)).toBe("Applied tags to 2/3 book(s). Committed: 1, 3. 1 failed: 2.\n#2: boom-2");
  });
});

// review round 1 — raw calibredb stderr must not break the one-line-per-id layout (#216)
describe("calibre_bulk_update per-id error lines stay one line (#216)", () => {
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
  const failing = (message: (id: string) => string) => async (args: readonly string[]) => {
    throw new Error(message(args[1]!));
  };

  it("collapses a multi-line error onto its #id line", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({ calibredb: failing((id) => `Traceback for ${id}:\n  File "x.py"\n\tValueError: bad\n`) }),
    );
    expect(text(r)).toContain('#1: Traceback for 1: File "x.py" ValueError: bad\n#2: ');
    expect(text(r)).toMatch(/#2: Traceback for 2: File "x\.py" ValueError: bad$/);
  });

  it("emits exactly one line per failed id", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps({ calibredb: failing(() => "a\nb\nc\nd") }),
    );
    expect(text(r).split("\n")).toEqual(["Applied tags to 0/2 book(s). 2 failed: 1, 2.", "#1: a b c d", "#2: a b c d"]);
  });

  it("truncates a long error to 200 chars ending in an ellipsis", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], preview: false },
      deps({ fixture: [book({ id: 1 })], calibredb: failing(() => "e".repeat(5000)) }),
    );
    expect(text(r).split("\n")[1]).toBe(`#1: ${"e".repeat(199)}…`);
  });

  it("keeps an error of exactly 200 chars whole", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], preview: false },
      deps({ fixture: [book({ id: 1 })], calibredb: failing(() => "e".repeat(200)) }),
    );
    expect(text(r).split("\n")[1]).toBe(`#1: ${"e".repeat(200)}`);
  });

  it("keeps the full structured error for clients that read structuredContent", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], preview: false },
      deps({ fixture: [book({ id: 1 })], calibredb: failing(() => "a\nb") }),
    );
    expect(r.structuredContent?.failed).toEqual([{ id: 1, error: "a\nb" }]);
  });
});

// #306: a list-field "set" replaces the whole list; the text preview must say so.
describe("calibre_bulk_update preview flags list replacement (#306)", () => {
  const previewText = async (changes: Record<string, unknown>, fixture: Book[]): Promise<string> => {
    const r = await bulkUpdateTool.handler(
      { changes, ids: fixture.map((b) => b.id), preview: true },
      deps({ fixture }),
    );
    return r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  };
  const fifteen = Array.from({ length: 15 }, (_, i) => `t${i}`);

  it("flags tags 15 → 1", async () => {
    const t = await previewText({ tags: ["zz"] }, [book({ id: 1, tags: fifteen })]);
    expect(t).toContain("tags: 15 → 1 (replaces all existing tags)");
  });

  it("flags authors and languages too", async () => {
    const t = await previewText({ authors: ["Solo"], languages: ["ru"] }, [
      book({ id: 1, authors: ["A", "B"], languages: ["en", "de"] }),
    ]);
    expect(t).toContain("authors: 2 → 1 (replaces all existing authors)");
    expect(t).toContain("languages: 2 → 1 (replaces all existing languages)");
  });

  it("flags identifiers by key count", async () => {
    const t = await previewText({ identifiers: { isbn: "1" } }, [
      book({ id: 1, identifiers: { isbn: "9", doi: "x", goodreads: "7" } }),
    ]);
    expect(t).toContain("identifiers: 3 → 1 (replaces all existing identifiers)");
  });

  it("flags string forms of list fields the way calibredb splits them", async () => {
    const a = await previewText({ authors: "Solo" }, [book({ id: 1, authors: ["A", "B"] })]);
    expect(a).toContain("authors: 2 → 1 (replaces all existing authors)");
    const t = await previewText({ tags: "a,b" }, [book({ id: 1, tags: ["x", "y", "z"] })]);
    expect(t).toContain("tags: 3 → 2 (replaces all existing tags)");
    const keep = await previewText({ authors: "A & B & C" }, [book({ id: 1, authors: ["A", "B"] })]);
    expect(keep).not.toContain("replaces all existing");
  });

  it("does not flag a scalar change, an empty-before list, or a list that only grows", async () => {
    const t = await previewText({ title: "New", series: "S" }, [book({ id: 1 })]);
    expect(t).not.toContain("replaces all existing");
    const empty = await previewText({ tags: ["a"] }, [book({ id: 1, tags: [] })]);
    expect(empty).not.toContain("replaces all existing");
    const grow = await previewText({ tags: ["old", "new"] }, [book({ id: 1, tags: ["old"] })]);
    expect(grow).not.toContain("replaces all existing");
  });
});

// PR #332 review (#325): a case-only tag set renames the shared Calibre item library-wide.
describe("calibre_bulk_update preview notes a case-only rename (#325)", () => {
  it("should_warn_that_python_renames_Python_on_every_book", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["python", "Rust"] }, ids: [1], preview: true },
      deps({ fixture: [book({ id: 1, tags: ["Python", "Rust"] })] }),
    );
    const t = r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    expect(t).toContain(
      "  ⚠ tags: Python → python renames it on every book in the library (Calibre keeps one case-insensitive item)",
    );
    expect(t).not.toContain("replaces all existing");
  });
});
