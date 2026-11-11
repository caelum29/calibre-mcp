// #413: calibre_merge_books treats a connection dropped mid-request like a timeout in every
// phase — a re-read decides; landed → done, otherwise the calibre_get_book steer, never a plain
// failure. A refused write is still reported as refused.

import { describe, it, expect, vi } from "vitest";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import { loadConfig } from "../../src/config.js";
import { log, type LogSink } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreHttpError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { noPruneIndex, type WithPrune } from "./fake-prune-index.js";
import type { ToolResult } from "../../src/tools/types.js";

vi.mock("../../src/calibre/http.js", () => ({
  downloadToFile: vi.fn(async () => ({ bytes: 1 })),
}));

const sink: LogSink = log;

// calibredb's stderr when the server reset the connection after the request went out.
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

// Target #10 has epub; source #12 brings pdf (moves) and extra tags/identifiers (metadata).
const target = book({ id: 10, formats: ["epub"], tags: ["t1"], identifiers: { isbn: "111" } });
const source = book({ id: 12, formats: ["pdf"], tags: ["t1", "t2"], identifiers: { isbn: "222", doi: "d1" } });
// What the target reads back once the metadata merge committed.
const merged = { tags: ["t1", "t2"], identifiers: { isbn: "111", doi: "d1" } };

interface Fake {
  /** calibredb subcommand that fails, and the stderr it fails with. */
  fail: { cmd: "add_format" | "set_metadata" | "remove"; stderr: string };
  /** The re-read state after the failure: what the target and source read back. */
  targetAfter?: Partial<Book>;
  sourceGone?: boolean;
}

function run(f: Fake): Promise<{ r: ToolResult; cmds: string[] }> {
  const cmds: string[] = [];
  const added: string[] = [];
  let failed = false;
  const getBook = async (id: number): Promise<Book> => {
    if (id === 12) {
      if (failed && f.sourceGone) throw new CalibreHttpError(404, "u", "gone");
      return source;
    }
    // after the failure the target reads as the fake says; before it, as stored plus any added format
    if (failed && f.targetAfter) return { ...target, ...f.targetAfter };
    return { ...target, formats: [...target.formats, ...added] };
  };
  const deps = {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, id === 10 ? target : source] as const)),
      getBook,
      bookMergeFacts: async () => ({ customFields: [], hasCover: true }),
    } as unknown as ToolDeps["content"],
    calibre: {
      calibredb: async (args: readonly string[]) => {
        cmds.push(args[0]!);
        if (args[0] === f.fail.cmd) {
          failed = true;
          throw new CalibreCliError(1, f.fail.stderr, f.fail.stderr);
        }
        if (args[0] === "add_format") added.push(args[3]!.split(".").pop()!);
        return { stdout: "", stderr: "" };
      },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    log: sink,
    ...noPruneIndex,
  } as WithPrune;
  return mergeBooksTool
    .handler({ targetId: 10, sourceIds: [12], mode: "merge", confirm: true }, deps)
    .then((r) => ({ r, cmds }));
}

const text = (r: ToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
const stepStatuses = (r: ToolResult) =>
  ((r.structuredContent?.steps ?? []) as { status: string }[]).map((s) => s.status);

describe("calibre_merge_books — Phase 1 add_format dropped mid-request (#413)", () => {
  it("should_count_the_move_done_when_the_re_read_shows_the_format_on_the_target", async () => {
    const { r, cmds } = await run({
      fail: { cmd: "add_format", stderr: DROPPED },
      targetAfter: { formats: ["epub", "pdf"], ...merged },
      sourceGone: true,
    });
    expect(r.structuredContent?.status).toBe("merged");
    expect(cmds).toEqual(["add_format", "set_metadata", "remove"]);
  });

  it("should_steer_to_calibre_get_book_when_the_re_read_lacks_the_format", async () => {
    const { r, cmds } = await run({ fail: { cmd: "add_format", stderr: DROPPED }, targetAfter: { formats: ["epub"] } });
    expect(text(r)).toContain("calibre_get_book id=10");
    expect(r.structuredContent?.errorCode).toBe("write_unverified");
    expect(cmds).toEqual(["add_format"]);
  });
});

describe("calibre_merge_books — Phase 2 set_metadata dropped mid-request (#413)", () => {
  it("should_count_the_merge_done_and_trash_sources_when_the_re_read_shows_the_merged_fields", async () => {
    const { r, cmds } = await run({
      fail: { cmd: "set_metadata", stderr: DROPPED },
      targetAfter: { formats: ["epub", "pdf"], ...merged },
      sourceGone: true,
    });
    expect(r.structuredContent?.status).toBe("merged");
    expect(cmds).toEqual(["add_format", "set_metadata", "remove"]);
  });

  it("should_steer_to_calibre_get_book_and_keep_sources_when_the_re_read_shows_the_old_fields", async () => {
    const { r, cmds } = await run({
      fail: { cmd: "set_metadata", stderr: DROPPED },
      targetAfter: { formats: ["epub", "pdf"] },
    });
    expect(r.structuredContent?.status).toBe("incomplete");
    expect(text(r)).toContain("calibre_get_book id=10");
    expect(text(r)).not.toContain("Connection reset by peer");
    expect(cmds).toEqual(["add_format", "set_metadata"]);
  });
});

describe("calibre_merge_books — Phase 3 remove dropped mid-request (#413)", () => {
  it("should_count_the_remove_done_when_every_source_404s_on_the_re_read", async () => {
    const { r } = await run({
      fail: { cmd: "remove", stderr: DROPPED },
      targetAfter: { formats: ["epub", "pdf"], ...merged },
      sourceGone: true,
    });
    expect(r.structuredContent?.status).toBe("merged");
    expect(stepStatuses(r)).toEqual(["done", "done", "done"]);
  });

  it("should_steer_to_calibre_get_book_when_a_source_still_exists", async () => {
    const { r } = await run({
      fail: { cmd: "remove", stderr: DROPPED },
      targetAfter: { formats: ["epub", "pdf"], ...merged },
    });
    expect(r.structuredContent?.status).toBe("incomplete");
    expect(text(r)).toContain("calibre_get_book id=12");
    expect(text(r)).not.toContain("Connection reset by peer");
  });
});

describe("calibre_merge_books — a refused write stays refused (#413)", () => {
  it("should_report_a_refused_metadata_merge_with_the_write_refused_steer", async () => {
    const { r, cmds } = await run({ fail: { cmd: "set_metadata", stderr: REFUSED } });
    expect(text(r)).toContain("--enable-local-write");
    expect(cmds).toEqual(["add_format", "set_metadata"]);
  });

  it("should_report_a_refused_remove_with_the_write_refused_steer", async () => {
    const { r } = await run({ fail: { cmd: "remove", stderr: REFUSED } });
    expect(text(r)).toContain("--enable-local-write");
  });
});
