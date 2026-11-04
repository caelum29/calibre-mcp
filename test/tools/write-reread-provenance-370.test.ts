// #370 §Write path box 1: a write we only know landed because a re-read confirmed it (the
// connection dropped, or calibredb timed out) says so in BOTH channels — structuredContent
// `confirmedByReRead` and the text — for calibre_update_book and calibre_bulk_update.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";

const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const HTTP503 = "HTTP Error 503: Service Unavailable";
const FORBIDDEN = "HTTP Error 403: Forbidden";
const TIMEOUT = "timeout";

/** calibredb fake: call N fails with outcomes[N-1] (null or past the end = success). */
const scripted = (outcomes: (string | null)[]) => {
  const spy = vi.fn(async () => {
    const outcome = outcomes[spy.mock.calls.length - 1];
    if (outcome === TIMEOUT) throw new CalibreCliTimeoutError("calibredb command timed out");
    if (outcome) throw new CalibreCliError(1, "calibredb command failed", outcome);
    return { stdout: "", stderr: "" };
  });
  return spy;
};

const book = (id: number, tags = ["old"]): Book => ({
  id,
  uuid: `u${id}`,
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags,
  languages: ["eng"],
});

/** Every read after the first write attempt shows the write landed. */
const deps = (calibredb: ReturnType<typeof scripted>): BaseDeps =>
  ({
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: async (id: number) => (calibredb.mock.calls.length === 0 ? book(id) : book(id, ["new"])),
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)] as const)),
    },
    calibre: { calibredb },
    sleep: async () => {},
    log,
  }) as unknown as BaseDeps;

// the text channel = every text block a text-only client shows
const allText = (r: { content: { type: string; text?: string }[] }): string =>
  r.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("\n");
const single = (outcomes: (string | null)[]) =>
  updateBookTool.handler({ id: 1, changes: { tags: ["new"] } }, deps(scripted(outcomes)));
const bulk = (ids: number[], outcomes: (string | null)[]) =>
  bulkUpdateTool.handler({ changes: { tags: ["new"] }, ids, preview: false }, deps(scripted(outcomes)));

describe("calibre_update_book — re-read provenance (#370)", () => {
  it("should_flag_a_dropped_write_confirmed_by_re_read_in_structuredContent", async () => {
    const r = await single([RESET, RESET, RESET]);
    expect(r.structuredContent?.confirmedByReRead).toBe("dropped");
  });

  it("should_say_so_in_the_text_for_a_dropped_write", async () => {
    const r = await single([RESET, RESET, RESET]);
    expect(allText(r)).toContain("Confirmed by a re-read after the connection dropped mid-request.");
  });

  it("should_flag_a_drop_then_refused_write_the_same_way", async () => {
    const r = await single([RESET, FORBIDDEN]);
    expect([r.structuredContent?.confirmedByReRead, allText(r).includes("after the connection dropped")]).toEqual([
      "dropped",
      true,
    ]);
  });

  it("should_flag_a_timed_out_write_confirmed_by_re_read", async () => {
    const r = await single([TIMEOUT]);
    expect([
      r.structuredContent?.confirmedByReRead,
      allText(r).includes("Confirmed by a re-read after calibredb timed out."),
    ]).toEqual(["timeout", true]);
  });

  it("should_not_flag_a_plain_successful_write", async () => {
    const r = await single([]);
    expect([r.structuredContent?.confirmedByReRead, allText(r).includes("re-read")]).toEqual([undefined, false]);
  });
});

describe("calibre_bulk_update — re-read provenance (#370)", () => {
  it("should_flag_a_last_book_drop_confirmed_by_re_read_in_both_channels", async () => {
    const r = await bulk([1, 2], [null, RESET, RESET, RESET]);
    expect([
      r.structuredContent?.confirmedByReRead,
      allText(r).includes("Confirmed by a re-read: 2 (connection dropped)."),
    ]).toEqual([[{ id: 2, cause: "dropped" }], true]);
  });

  it("should_flag_a_drop_then_503_that_landed_and_kept_looping", async () => {
    const r = await bulk([1, 2], [RESET, HTTP503, HTTP503, null]);
    expect([
      r.structuredContent?.confirmedByReRead,
      allText(r).includes("Confirmed by a re-read: 1 (connection dropped)."),
    ]).toEqual([[{ id: 1, cause: "dropped" }], true]);
  });

  it("should_flag_a_timed_out_book_confirmed_by_re_read", async () => {
    const r = await bulk([1, 2], [TIMEOUT, null]);
    expect([
      r.structuredContent?.confirmedByReRead,
      allText(r).includes("Confirmed by a re-read: 1 (timed out)."),
    ]).toEqual([[{ id: 1, cause: "timeout" }], true]);
  });

  it("should_flag_the_confirmed_book_that_stopped_the_batch_in_structuredContent", async () => {
    const r = await bulk([1, 2, 3], [null, RESET, RESET, RESET]);
    expect(r.structuredContent?.confirmedByReRead).toEqual([{ id: 2, cause: "dropped" }]);
  });

  it("should_name_an_earlier_confirmed_book_when_a_later_refusal_stops_the_batch", async () => {
    const r = await bulk([1, 2, 3], [TIMEOUT, FORBIDDEN]);
    expect([
      r.structuredContent?.confirmedByReRead,
      allText(r).includes("Confirmed by a re-read: 1 (timed out)."),
    ]).toEqual([[{ id: 1, cause: "timeout" }], true]);
  });

  it("should_not_flag_a_plain_successful_run", async () => {
    const r = await bulk([1, 2], []);
    expect([r.structuredContent?.confirmedByReRead, allText(r).includes("re-read")]).toEqual([undefined, false]);
  });

  it("should_stay_outputSchema_valid_with_confirmed_books", async () => {
    const r = await bulk([1, 2], [TIMEOUT, null]);
    const out = z.object(bulkUpdateTool.outputSchema!).strict();
    expect(out.safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success).toBe(true);
  });

  it("should_keep_update_book_outputSchema_valid_with_the_flag", async () => {
    const r = await single([TIMEOUT]);
    const out = z.object(updateBookTool.outputSchema!).strict();
    expect(out.safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success).toBe(true);
  });
});
