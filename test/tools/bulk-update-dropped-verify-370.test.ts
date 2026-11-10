// #370 §Invariant gap: a bulk write whose connection dropped mid-request may have committed,
// so it is re-read like the single-book path (#342): confirmed → counted as applied, not failed;
// unconfirmed → failed with the calibre_get_book steer. The breaker still stops the loop.

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";

// probed calibredb stderr tails (233-transient-stderr.md)
const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const HTTP500 = "httperror_seek_wrapper: HTTP Error 500: Internal Server Error";
const MAY = (id: number) => `may have been committed — verify with calibre_get_book id=${id} before retrying`;

/** calibredb fake: call N throws with stderr outcomes[N-1] (null or past the end = success). */
const scripted = (outcomes: (string | null)[]) => {
  const spy = vi.fn(async () => {
    const stderr = outcomes[spy.mock.calls.length - 1];
    if (stderr) throw new CalibreCliError(1, "calibredb command failed", stderr);
    return { stdout: "", stderr: "" };
  });
  return spy;
};

const book = (id: number, over: Partial<Book> = {}): Book => ({
  id,
  uuid: `u${id}`,
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: ["en"],
  ...over,
});

/** Selection reads see the before-state; `reRead` answers the post-failure verify. */
const deps = (
  calibredb: () => Promise<{ stdout: string; stderr: string }>,
  reRead: (id: number) => Promise<Book>,
): BaseDeps =>
  ({
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: reRead,
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)] as const)),
    },
    calibre: { calibredb },
    sleep: async () => {},
    log,
  }) as unknown as BaseDeps;

const landed = async (id: number) => book(id, { tags: ["new"] });
const unchanged = async (id: number) => book(id);
const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
const failedIds = (r: { structuredContent?: Record<string, unknown> }): number[] =>
  ((r.structuredContent?.failed as { id: number }[] | undefined) ?? []).map((f) => f.id);
const apply = (ids: number[], changes: Record<string, unknown> = { tags: ["new"] }) => ({
  changes,
  ids,
  preview: false,
});

// book 2 of 3 drops on every attempt (1 try + 2 retries)
const DROP_ON_2 = [null, RESET, RESET, RESET];

describe("calibre_bulk_update — dropped write is verified by re-read (#370)", () => {
  it("should_count_a_dropped_but_landed_book_as_applied", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted(DROP_ON_2), landed));
    expect([r.structuredContent?.applied, failedIds(r)]).toEqual([[1, 2], []]);
  });

  it("should_still_stop_the_loop_after_a_landed_drop", async () => {
    const spy = scripted(DROP_ON_2);
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(spy, landed));
    // 1 call for book 1, 3 for book 2, none for book 3 — and no retry after the verify
    expect([r.isError, spy.mock.calls.length, r.structuredContent?.notAttempted]).toEqual([true, 4, [3]]);
  });

  it("should_hand_back_only_the_unattempted_ids_when_the_drop_landed", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted(DROP_ON_2), landed));
    expect(r.structuredContent?.retryIds).toEqual([3]);
  });

  it("should_name_the_landed_book_as_committed_in_the_text", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted(DROP_ON_2), landed));
    expect(text(r)).toBe(
      "Error: Stopped: the Calibre Content Server is unreachable after 2/3 book(s) were already updated. " +
        "Already committed: 1, 2. Not attempted: 3. " +
        "The connection dropped mid-request, but a re-read confirmed book 2 was written. " +
        "Once the Content Server is back, re-run with ids=[3]." +
        "\nCode: calibre_unreachable\nNext: start it in Calibre (Connect/share → Start Content server) or set CALIBRE_MCP_SERVER_URL",
    );
  });

  it("should_not_tell_the_model_to_verify_a_confirmed_write", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted(DROP_ON_2), landed));
    expect(text(r)).not.toContain(MAY(2));
  });

  it("should_return_an_outputSchema_valid_result_for_a_landed_drop", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted(DROP_ON_2), landed));
    const schema = z.object(bulkUpdateTool.outputSchema!);
    expect(schema.safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success).toBe(true);
  });

  it("should_report_success_when_the_last_book_dropped_and_landed", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2]), deps(scripted([null, RESET, RESET, RESET]), landed));
    // #370 §Write path box 1 (approved by orchestrator): the success names its re-read
    expect([
      r.isError ?? false,
      r.structuredContent?.applied,
      failedIds(r),
      text(r),
      r.structuredContent?.confirmedByReRead,
    ]).toEqual([
      false,
      [1, 2],
      [],
      "Applied tags to 2/2 book(s). Confirmed by a re-read: 2 (connection dropped).",
      [{ id: 2, cause: "dropped" }],
    ]);
  });

  it("should_keep_an_earlier_own_failure_out_of_retryIds_after_a_landed_drop", async () => {
    // book 1: HTTP 500 (its own failure, not retried); book 2: drops but lands; book 3 unattempted
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted([HTTP500, RESET, RESET, RESET]), landed));
    expect([r.structuredContent?.applied, failedIds(r), r.structuredContent?.retryIds]).toEqual([[2], [1], [3]]);
  });

  it("should_agree_on_counts_between_text_and_structuredContent_with_an_earlier_failure", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted([HTTP500, RESET, RESET, RESET]), landed));
    expect(text(r)).toContain("after 1/3 book(s) were already updated. Already committed: 2. Failed: 1. ");
  });

  it("should_fail_a_dropped_book_with_the_verify_steer_when_the_re_read_shows_no_change", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted(DROP_ON_2), unchanged));
    const failed = r.structuredContent?.failed as { id: number; error: string }[];
    expect([r.structuredContent?.applied, failed.length, failed[0]?.id, failed[0]?.error.includes(MAY(2))]).toEqual([
      [1],
      1,
      2,
      true,
    ]);
  });

  it("should_fail_a_dropped_book_with_the_verify_steer_when_the_re_read_throws", async () => {
    const r = await bulkUpdateTool.handler(
      apply([1, 2, 3]),
      deps(scripted(DROP_ON_2), async () => {
        throw new Error("Content Server gone");
      }),
    );
    expect([failedIds(r), text(r).includes(MAY(2))]).toEqual([[2], true]);
  });

  it("should_fail_a_dropped_book_when_only_some_requested_fields_landed", async () => {
    const r = await bulkUpdateTool.handler(
      apply([1, 2], { tags: ["new"], publisher: "P" }),
      deps(scripted([null, RESET, RESET, RESET]), landed),
    );
    expect([r.structuredContent?.applied, failedIds(r)]).toEqual([[1], [2]]);
  });
});
