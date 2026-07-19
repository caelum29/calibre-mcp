// calibre_merge_books handler tests (spec #50 §8 layer 1). House pattern: fake calibredb
// via ToolDeps, downloadToFile mocked at the module boundary (mock-only-at-boundaries) —
// covers the dry-run gate, the delete-LAST call-order ledger, collision-as-skip, the #33
// abort/degrade semantics, client-side unions, and Zod coercion.

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { CustomFieldValue } from "../../src/domain/merge.js";
import {
  CalibreCliError,
  CalibreCliTimeoutError,
  CalibreHttpError,
} from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/types.js";

vi.mock("../../src/calibre/http.js", () => ({
  downloadToFile: vi.fn(async () => ({ bytes: 1 })),
}));

const book = (over: Partial<Book> = {}): Book => ({
  id: 1, uuid: "u", title: "Dup Book", authors: ["A"], identifiers: {}, formats: [],
  tags: [], languages: [], ...over,
});

type CalibredbFake = (
  args: readonly string[],
  opts?: { library?: string },
) => Promise<{ stdout: string; stderr: string }>;

interface FakeOpts {
  books?: Book[];
  facts?: Map<number, { customFields: CustomFieldValue[]; hasCover: boolean }>;
  calibredb?: CalibredbFake;
  /** getBook override for post-write verify reads (defaults to the books map). */
  getBook?: (id: number) => Promise<Book>;
}

function fakeDeps(opts: FakeOpts = {}) {
  const books = opts.books ?? [
    book({ id: 10, formats: ["epub"], tags: ["t1"], identifiers: { isbn: "111" }, comments: "dest c" }),
    book({ id: 12, formats: ["pdf", "epub"], tags: ["t1", "t2"], identifiers: { isbn: "222", doi: "d1" }, comments: "src c" }),
  ];
  const byId = new Map(books.map((b) => [b.id, b] as const));
  const calls: string[][] = [];
  // Behave like the live server: formats successfully added show up in later reads.
  const addedFormats = new Map<number, string[]>();
  const calibredb: CalibredbFake = opts.calibredb ?? (async () => ({ stdout: "", stderr: "" }));
  const spy = vi.fn(async (args: readonly string[], o?: { library?: string }) => {
    calls.push([...args]);
    const result = await calibredb(args, o);
    if (args[0] === "add_format") {
      const id = Number(args[2]);
      const fmt = args[3]!.split(".").pop()!;
      addedFormats.set(id, [...(addedFormats.get(id) ?? []), fmt]);
    }
    return result;
  });
  const content = {
    resolveLibraryId: async (): Promise<string> => "Programming_Books",
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
    getBook:
      opts.getBook ??
      (async (id: number): Promise<Book> => {
        const b = byId.get(id);
        if (!b) throw new CalibreHttpError(404, "u", "not found");
        return { ...b, formats: [...b.formats, ...(addedFormats.get(id) ?? [])] };
      }),
    bookMergeFacts: async (id: number) =>
      opts.facts?.get(id) ?? { customFields: [], hasCover: true },
  };
  const deps = {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb: spy } as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    log,
  } as ToolDeps;
  return { deps, spy, calls };
}

const run = (args: Record<string, unknown>, d: ReturnType<typeof fakeDeps>) =>
  mergeBooksTool.handler({ mode: "merge", confirm: false, ...args }, d.deps);

describe("calibre_merge_books dry run", () => {
  it("writes nothing and returns the full plan", async () => {
    const d = fakeDeps();
    const r = await run({ targetId: 10, sourceIds: [12] }, d);
    expect(r.isError).toBeFalsy();
    expect(d.spy).not.toHaveBeenCalled();
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("Survivor: #10");
    expect(text).toContain("#12 pdf → moves to #10");
    expect(text).toContain("#12 epub → DROPPED — target's copy wins");
    expect(text).toContain("trashed (recoverable");
    expect(r.structuredContent?.status).toBe("planned");
    const changes = r.structuredContent?.metadataChanges as Record<string, unknown>;
    expect(changes.tags).toEqual(["t1", "t2"]);
  });

  it("prepends an advisory warning when a source looks like a different work", async () => {
    const d = fakeDeps({
      books: [
        book({ id: 10, title: "Rust Book" }),
        book({ id: 12, title: "Cooking For Two", authors: ["Z"] }),
      ],
    });
    const r = await run({ targetId: 10, sourceIds: [12] }, d);
    expect((r.content[0] as { text: string }).text).toContain("does not look like the same work");
  });

  it("omits the metadata diff in formatsOnly mode", async () => {
    const d = fakeDeps();
    const r = await run({ targetId: 10, sourceIds: [12], mode: "formatsOnly" }, d);
    expect((r.content[0] as { text: string }).text).toContain("Metadata: untouched");
  });

  it("rejects sourceIds containing the targetId", async () => {
    const d = fakeDeps();
    const r = await run({ targetId: 10, sourceIds: [10, 12] }, d);
    expect(r.isError).toBe(true);
    expect(d.spy).not.toHaveBeenCalled();
  });

  it("errors with a steer when a book id does not resolve", async () => {
    const d = fakeDeps();
    const r = await run({ targetId: 10, sourceIds: [99] }, d);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("99");
  });
});

describe("calibre_merge_books execution order", () => {
  it("runs add_format → one set_metadata → remove LAST, and unions are written whole", async () => {
    const d = fakeDeps();
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.isError).toBeFalsy();
    const subs = d.calls.map((c) => c[0]);
    expect(subs).toEqual(["add_format", "set_metadata", "remove"]);
    expect(d.calls[0]).toEqual(["add_format", "--dont-replace", "10", expect.stringContaining("12.pdf")]);
    // client-side unions written whole: tags union + identifiers with target precedence
    const fields = d.calls[1]!.filter((a) => a !== "--field" && a !== "set_metadata" && a !== "10");
    expect(fields).toContain("tags:t1,t2");
    expect(fields.some((f) => f.startsWith("identifiers:") && f.includes("isbn:111") && f.includes("doi:d1"))).toBe(true);
    expect(d.calls[2]).toEqual(["remove", "12"]);
    expect(r.structuredContent?.status).toBe("merged");
  });

  it("mode=safe merges but never removes sources", async () => {
    const d = fakeDeps();
    await run({ targetId: 10, sourceIds: [12], mode: "safe", confirm: true }, d);
    expect(d.calls.map((c) => c[0])).toEqual(["add_format", "set_metadata"]);
  });

  it("mode=formatsOnly moves formats and removes, never touching metadata", async () => {
    const d = fakeDeps();
    await run({ targetId: 10, sourceIds: [12], mode: "formatsOnly", confirm: true }, d);
    expect(d.calls.map((c) => c[0])).toEqual(["add_format", "remove"]);
  });

  it("treats the --dont-replace collision exit as a benign skip and continues", async () => {
    const d = fakeDeps({
      calibredb: async (args) => {
        if (args[0] === "add_format") {
          throw new CalibreCliError(1, "failed", "A PDF file already exists for book: 10, not replacing");
        }
        return { stdout: "", stderr: "" };
      },
    });
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.isError).toBeFalsy();
    expect(d.calls.map((c) => c[0])).toEqual(["add_format", "set_metadata", "remove"]);
    const steps = r.structuredContent?.steps as { status: string }[];
    expect(steps[0]!.status).toBe("skipped");
  });

  it("tolerates stdout noise like 'Using proxies' from calibredb", async () => {
    const d = fakeDeps({
      calibredb: async () => ({ stdout: "Using proxies: {'http': 'x'}\n", stderr: "" }),
    });
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.structuredContent?.status).toBe("merged");
  });
});

describe("calibre_merge_books failure semantics (#33)", () => {
  it("aborts before remove and returns isError when nothing committed", async () => {
    const d = fakeDeps({
      calibredb: async (args) => {
        if (args[0] === "add_format") throw new CalibreCliError(1, "boom", "disk full");
        return { stdout: "", stderr: "" };
      },
    });
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.isError).toBe(true);
    expect(d.calls.map((c) => c[0])).toEqual(["add_format"]); // no set_metadata, no remove
    const steps = r.structuredContent?.steps as { status: string }[];
    expect(steps.map((s) => s.status)).toEqual(["failed", "not-run", "not-run"]);
  });

  it("degrades to success-incomplete (never isError) when a later step fails after a commit", async () => {
    const d = fakeDeps({
      calibredb: async (args) => {
        if (args[0] === "set_metadata") throw new CalibreCliError(1, "boom", "nope");
        return { stdout: "", stderr: "" };
      },
    });
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.status).toBe("incomplete");
    expect(d.calls.map((c) => c[0])).toEqual(["add_format", "set_metadata"]); // remove never ran
    expect((r.content[0] as { text: string }).text).toContain("Re-run the same call");
  });

  it("verifies a timed-out add_format against a re-read and counts it done when landed", async () => {
    const d = fakeDeps({
      calibredb: async (args) => {
        if (args[0] === "add_format") throw new CalibreCliTimeoutError("timeout");
        return { stdout: "", stderr: "" };
      },
      // Verify re-read shows the pdf already on the target → the write committed.
      getBook: async (id) => book({ id, formats: ["epub", "pdf"] }),
    });
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.structuredContent?.status).toBe("merged");
    const steps = r.structuredContent?.steps as { status: string }[];
    expect(steps[0]!.status).toBe("done");
  });

  it("fails a timed-out add_format the re-read does not confirm, without removing sources", async () => {
    const d = fakeDeps({
      calibredb: async (args) => {
        if (args[0] === "add_format") throw new CalibreCliTimeoutError("timeout");
        return { stdout: "", stderr: "" };
      },
      getBook: async (id) => book({ id, formats: ["epub"] }),
    });
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.isError).toBe(true); // nothing committed
    expect(d.calls.map((c) => c[0])).toEqual(["add_format"]);
  });

  it("verifies a timed-out remove via /ajax 404s and reports success", async () => {
    const d = fakeDeps({
      calibredb: async (args) => {
        if (args[0] === "remove") throw new CalibreCliTimeoutError("timeout");
        return { stdout: "", stderr: "" };
      },
      getBook: async (id) => {
        if (id === 12) throw new CalibreHttpError(404, "u", "gone"); // source removed
        return book({ id, formats: ["epub", "pdf"] });
      },
    });
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.structuredContent?.status).toBe("merged");
  });

  it("returns the write-refused steer when the server blocks writes", async () => {
    const d = fakeDeps({
      calibredb: async () => {
        throw new CalibreCliError(1, "failed", "HTTP Error 403: Forbidden");
      },
    });
    const r = await run({ targetId: 10, sourceIds: [12], confirm: true }, d);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("--enable-local-write");
  });
});

describe("calibre_merge_books schema coercion", () => {
  const schema = z.object(mergeBooksTool.inputSchema);

  it("coerces stringified ids, JSON-string arrays, and keeps 'false' false", () => {
    const p = schema.parse({ targetId: "10", sourceIds: '["11","12"]', confirm: "false" });
    expect(p.targetId).toBe(10);
    expect(p.sourceIds).toEqual([11, 12]);
    expect(p.confirm).toBe(false);
    expect(p.mode).toBe("merge");
  });

  it("registers as a gated destructive write", () => {
    expect(mergeBooksTool.write).toBe(true);
    expect(mergeBooksTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
  });
});
