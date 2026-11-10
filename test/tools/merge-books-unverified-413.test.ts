// #413 review: a merge step a re-read could not confirm may have committed, so the result never
// says "Nothing was changed", and a partial remove steers to a re-run with only the sources left.

import { describe, it, expect, vi } from "vitest";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import { loadConfig } from "../../src/config.js";
import { log, type LogSink } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreHttpError } from "../../src/domain/errors.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

vi.mock("../../src/calibre/http.js", () => ({
  downloadToFile: vi.fn(async () => ({ bytes: 1 })),
}));

const sink: LogSink = log;
const DROPPED = "ConnectionResetError: [Errno 54] Connection reset by peer";
const REFUSED = "HTTP Error 403: Forbidden";

const book = (over: Partial<Book>): Book => ({
  id: 1,
  uuid: "u",
  title: "Dup Book",
  authors: ["A"],
  identifiers: {},
  formats: [],
  tags: [],
  languages: [],
  ...over,
});

interface Fake {
  books: Book[];
  sourceIds: number[];
  fail: { cmd: string; stderr: string };
  /** Ids that 404 after the failure (a dropped remove that deleted some sources). */
  goneAfter?: number[];
}

async function run(f: Fake): Promise<ToolResult> {
  const byId = new Map(f.books.map((b) => [b.id, b] as const));
  let failed = false;
  const deps = {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
      getBook: async (id: number): Promise<Book> => {
        if (failed && f.goneAfter?.includes(id)) throw new CalibreHttpError(404, "u", "gone");
        return byId.get(id)!;
      },
      bookMergeFacts: async () => ({ customFields: [], hasCover: true }),
    } as unknown as ToolDeps["content"],
    calibre: {
      calibredb: async (args: readonly string[]) => {
        if (args[0] === f.fail.cmd) {
          failed = true;
          throw new CalibreCliError(1, f.fail.stderr, f.fail.stderr);
        }
        // a committed add shows up on the target's later re-reads, like the live server
        if (args[0] === "add_format") {
          const t = byId.get(Number(args[2]))!;
          byId.set(t.id, { ...t, formats: [...t.formats, args[3]!.split(".").pop()!] });
        }
        return { stdout: "", stderr: "" };
      },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    log: sink,
  } as BaseDeps;
  return mergeBooksTool.handler({ targetId: 10, sourceIds: f.sourceIds, mode: "merge", confirm: true }, deps);
}

const text = (r: ToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

describe("calibre_merge_books — first step unverified (#413 review)", () => {
  // Target lacks pdf; source #12 brings it. The dropped add_format re-reads without pdf.
  const books = [book({ id: 10, formats: ["epub"] }), book({ id: 12, formats: ["pdf"] })];

  it("should_not_claim_nothing_was_changed_when_the_first_step_may_have_committed", async () => {
    const r = await run({ books, sourceIds: [12], fail: { cmd: "add_format", stderr: DROPPED } });
    expect(text(r)).not.toContain("Nothing was changed");
  });

  it("should_steer_to_calibre_get_book_when_the_first_step_may_have_committed", async () => {
    const r = await run({ books, sourceIds: [12], fail: { cmd: "add_format", stderr: DROPPED } });
    expect(text(r)).toContain("calibre_get_book id=10");
  });

  it("should_still_say_nothing_was_changed_when_the_first_step_was_refused", async () => {
    const r = await run({ books, sourceIds: [12], fail: { cmd: "add_format", stderr: REFUSED } });
    expect(text(r)).toContain("Nothing was changed");
  });
});

describe("calibre_merge_books — dropped remove deleted one of two sources (#413 review)", () => {
  // #12 brings pdf (the move commits), then the remove drops after trashing #12 only.
  const books = [book({ id: 10 }), book({ id: 12, formats: ["pdf"] }), book({ id: 13 })];
  const partial = () => run({ books, sourceIds: [12, 13], fail: { cmd: "remove", stderr: DROPPED }, goneAfter: [12] });

  it("should_name_the_source_that_still_exists_as_the_re_run_input", async () => {
    expect(text(await partial())).toContain("sourceIds=[13]");
  });

  it("should_not_tell_the_model_to_re_run_the_same_call_unchanged", async () => {
    expect(text(await partial())).not.toContain("Re-run the same call");
  });

  it("should_report_the_partial_merge_as_incomplete_not_as_an_error", async () => {
    const r = await partial();
    expect(r.structuredContent?.status).toBe("incomplete");
  });
});
