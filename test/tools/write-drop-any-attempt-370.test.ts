// #370 review: a retried write that dropped mid-request on ANY attempt may have committed,
// even when a later attempt failed differently (connection refused, 503, 500). Both write
// paths must re-read it, and the result's errorCode must agree with what the re-read found.

import { describe, it, expect, vi } from "vitest";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { isDroppedMidRequest, withTransientRetry } from "../../src/app/write-policy.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";

// probed calibredb stderr tails (233-transient-stderr.md)
const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const REFUSED = "urllib.error.URLError: <urlopen error [Errno 61] Connection refused>";
const HTTP503 = "httperror_seek_wrapper: HTTP Error 503: Service Unavailable";
const HTTP500 = "httperror_seek_wrapper: HTTP Error 500: Internal Server Error";
const MAY = (id: number) => `may have been committed — verify with calibre_get_book id=${id} before retrying`;
const CONFIRMED = (id: number) => `a re-read confirmed book ${id} was written`;

/** calibredb fake: call N throws with stderr outcomes[N-1] (null or past the end = success). */
const scripted = (outcomes: (string | null)[]) => {
  const spy = vi.fn(async () => {
    const stderr = outcomes[spy.mock.calls.length - 1];
    if (stderr) throw new CalibreCliError(1, "calibredb command failed", stderr);
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
  languages: ["en"],
});

/** `afterWrite`: what a re-read of a book returns once its write is attempted. */
const deps = (calibredb: ReturnType<typeof scripted>, afterWrite: "landed" | "unchanged") => {
  // reads before the first write attempt (update_book's before-snapshot) see the old state
  return {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: async (id: number) =>
        afterWrite === "landed" && calibredb.mock.calls.length > 0 ? book(id, ["new"]) : book(id),
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)] as const)),
    },
    calibre: { calibredb },
    sleep: async () => {},
    log,
  } as unknown as BaseDeps;
};

const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
const failedIds = (r: { structuredContent?: Record<string, unknown> }): number[] =>
  ((r.structuredContent?.failed as { id: number }[] | undefined) ?? []).map((f) => f.id);
const bulk = (ids: number[], d: BaseDeps) =>
  bulkUpdateTool.handler({ changes: { tags: ["new"] }, ids, preview: false }, d);
const single = (d: BaseDeps) => updateBookTool.handler({ id: 1, changes: { tags: ["new"] } }, d);

describe("withTransientRetry remembers a drop on an earlier attempt (#370)", () => {
  const thrown = async (outcomes: (string | null)[]): Promise<unknown> =>
    withTransientRetry(scripted(outcomes), async () => {}).then(
      () => "resolved",
      (err: unknown) => err,
    );

  it("should_mark_drop_then_connection_refused_as_dropped", async () => {
    expect(isDroppedMidRequest(await thrown([RESET, REFUSED, REFUSED]))).toBe(true);
  });

  it("should_mark_drop_then_503_as_dropped", async () => {
    expect(isDroppedMidRequest(await thrown([RESET, HTTP503, HTTP503]))).toBe(true);
  });

  it("should_mark_drop_then_a_non_retried_500_as_dropped", async () => {
    expect(isDroppedMidRequest(await thrown([RESET, HTTP500]))).toBe(true);
  });

  it("should_not_mark_a_write_that_never_dropped", async () => {
    expect(isDroppedMidRequest(await thrown([REFUSED, HTTP503, REFUSED]))).toBe(false);
  });

  it("should_add_no_attempts_beyond_the_two_retries", async () => {
    const spy = scripted([RESET, REFUSED, REFUSED, null]);
    await withTransientRetry(spy, async () => {}).catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe("calibre_bulk_update — drop on an earlier attempt (#370)", () => {
  it("should_count_a_first_book_drop_then_refused_as_applied_when_it_landed", async () => {
    const r = await bulk([1, 2], deps(scripted([RESET, REFUSED, REFUSED]), "landed"));
    expect([r.structuredContent?.applied, failedIds(r), r.structuredContent?.notAttempted]).toEqual([[1], [], [2]]);
  });

  it("should_stop_with_calibre_unreachable_and_the_confirmed_steer_in_both_channels", async () => {
    const r = await bulk([1, 2], deps(scripted([RESET, REFUSED, REFUSED]), "landed"));
    expect([
      r.isError,
      r.structuredContent?.errorCode,
      r.structuredContent?.retryIds,
      text(r).includes(CONFIRMED(1)),
      text(r).includes(MAY(1)),
    ]).toEqual([true, "calibre_unreachable", [2], true, false]);
  });

  it("should_fail_a_first_book_drop_then_refused_as_unverified_when_it_did_not_land", async () => {
    const r = await bulk([1, 2], deps(scripted([RESET, REFUSED, REFUSED]), "unchanged"));
    expect([
      r.structuredContent?.errorCode,
      failedIds(r),
      r.structuredContent?.retryIds,
      text(r).includes(MAY(1)),
    ]).toEqual(["write_unverified", [1], [1, 2], true]);
  });

  it("should_count_a_drop_then_503_as_applied_and_keep_looping", async () => {
    const spy = scripted([RESET, HTTP503, HTTP503, null]);
    const r = await bulk([1, 2], deps(spy, "landed"));
    expect([r.isError ?? false, r.structuredContent?.applied, failedIds(r), spy.mock.calls.length]).toEqual([
      false,
      [1, 2],
      [],
      4,
    ]);
  });

  it("should_fail_an_unconfirmed_drop_then_503_with_the_verify_steer_and_keep_looping", async () => {
    const r = await bulk([1, 2], deps(scripted([RESET, HTTP503, HTTP503, null]), "unchanged"));
    expect([r.structuredContent?.applied, failedIds(r), text(r).includes(`#1: `), text(r).includes(MAY(1))]).toEqual([
      [2],
      [1],
      true,
      true,
    ]);
  });

  it("should_report_calibre_unreachable_for_a_confirmed_drop_that_stopped_the_batch_mid_loop", async () => {
    const r = await bulk([1, 2, 3], deps(scripted([null, RESET, RESET, RESET]), "landed"));
    expect(r.structuredContent?.errorCode).toBe("calibre_unreachable");
  });
});

describe("calibre_update_book — drop on an earlier attempt (#370)", () => {
  it("should_report_success_for_drop_then_refused_when_it_landed", async () => {
    const r = await single(deps(scripted([RESET, REFUSED, REFUSED]), "landed"));
    expect([r.isError ?? false, r.structuredContent?.noop]).toEqual([false, false]);
  });

  it("should_report_success_for_drop_then_503_when_it_landed", async () => {
    const r = await single(deps(scripted([RESET, HTTP503, HTTP503]), "landed"));
    expect([r.isError ?? false, text(r).startsWith("Updated book 1: tags.")]).toEqual([false, true]);
  });

  it("should_steer_to_calibre_get_book_for_drop_then_503_when_it_did_not_land", async () => {
    const r = await single(deps(scripted([RESET, HTTP503, HTTP503]), "unchanged"));
    expect([r.isError, r.structuredContent?.errorCode, text(r).includes(MAY(1))]).toEqual([
      true,
      "write_unverified",
      true,
    ]);
  });
});
