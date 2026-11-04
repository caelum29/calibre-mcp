// #370 review round 2: a retry that dropped mid-request and was then REFUSED may have committed
// on the dropped attempt, so both write paths re-read before trusting the refusal. Also: the
// "after N retries" wording reports the retries that actually ran.

import { describe, it, expect, vi } from "vitest";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";

// probed calibredb stderr tails (233-transient-stderr.md); TIMEOUT throws a CalibreCliTimeoutError
const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const FORBIDDEN = "HTTP Error 403: Forbidden";
const TIMEOUT = "timeout";
const MAY = (id: number) => `may have been committed — verify with calibre_get_book id=${id} before retrying`;
const LOCAL_WRITE = "--enable-local-write";

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
  languages: ["en"],
});

type ReRead = "landed" | "unchanged" | "throws";

/** Reads before the first write attempt (update_book's before-snapshot) see the old state. */
const deps = (calibredb: ReturnType<typeof scripted>, reRead: ReRead): BaseDeps =>
  ({
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: async (id: number) => {
        if (calibredb.mock.calls.length === 0 || reRead === "unchanged") return book(id);
        if (reRead === "throws") throw new Error("Content Server gone");
        return book(id, ["new"]);
      },
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)] as const)),
    },
    calibre: { calibredb },
    sleep: async () => {},
    log,
  }) as unknown as BaseDeps;

const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
const failedIds = (r: { structuredContent?: Record<string, unknown> }): number[] =>
  ((r.structuredContent?.failed as { id: number }[] | undefined) ?? []).map((f) => f.id);
const failedError = (r: { structuredContent?: Record<string, unknown> }): string =>
  (r.structuredContent?.failed as { error: string }[] | undefined)?.[0]?.error ?? "";
const bulk = (ids: number[], d: BaseDeps) =>
  bulkUpdateTool.handler({ changes: { tags: ["new"] }, ids, preview: false }, d);
const single = (d: BaseDeps) => updateBookTool.handler({ id: 1, changes: { tags: ["new"] } }, d);

describe("calibre_update_book — drop then refused (#370)", () => {
  it("should_report_success_when_the_dropped_attempt_landed", async () => {
    const r = await single(deps(scripted([RESET, FORBIDDEN]), "landed"));
    expect([r.isError ?? false, text(r).startsWith("Updated book 1: tags.")]).toEqual([false, true]);
  });

  it("should_keep_the_refusal_when_the_re_read_shows_no_change", async () => {
    const r = await single(deps(scripted([RESET, FORBIDDEN]), "unchanged"));
    expect([r.structuredContent?.errorCode, text(r).includes(LOCAL_WRITE)]).toEqual(["write_refused", true]);
  });

  it("should_steer_to_calibre_get_book_when_the_re_read_throws", async () => {
    const r = await single(deps(scripted([RESET, FORBIDDEN]), "throws"));
    expect([r.structuredContent?.errorCode, text(r).includes(MAY(1))]).toEqual(["write_unverified", true]);
  });

  it("should_make_no_attempt_after_the_refusal", async () => {
    const spy = scripted([RESET, FORBIDDEN]);
    await single(deps(spy, "landed"));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("calibre_bulk_update — drop then refused on book 1 of 3 (#370)", () => {
  it("should_count_book_1_as_applied_and_stop_on_the_refusal_when_it_landed", async () => {
    const spy = scripted([RESET, FORBIDDEN]);
    const r = await bulk([1, 2, 3], deps(spy, "landed"));
    expect([
      r.structuredContent?.errorCode,
      r.structuredContent?.applied,
      failedIds(r),
      r.structuredContent?.retryIds,
      spy.mock.calls.length,
    ]).toEqual(["write_refused", [1], [], [2, 3], 2]);
  });

  it("should_say_the_re_read_confirmed_book_1_and_keep_the_refusal_steer_in_the_text", async () => {
    const r = await bulk([1, 2, 3], deps(scripted([RESET, FORBIDDEN]), "landed"));
    expect([
      text(r).includes("Already committed: 1."),
      text(r).includes("A re-read confirmed book 1 was written before the refusal."),
      text(r).includes(LOCAL_WRITE),
      text(r).includes(MAY(1)),
    ]).toEqual([true, true, true, false]);
  });

  it("should_keep_the_bare_refusal_when_book_1_did_not_land", async () => {
    const r = await bulk([1, 2, 3], deps(scripted([RESET, FORBIDDEN]), "unchanged"));
    expect([r.structuredContent?.errorCode, r.structuredContent?.applied, text(r).includes(LOCAL_WRITE)]).toEqual([
      "write_refused",
      undefined,
      true,
    ]);
  });

  it("should_report_write_unverified_with_the_verify_steer_when_the_re_read_throws", async () => {
    const r = await bulk([1, 2, 3], deps(scripted([RESET, FORBIDDEN]), "throws"));
    expect([
      r.structuredContent?.errorCode,
      failedIds(r),
      r.structuredContent?.retryIds,
      text(r).includes(MAY(1)),
    ]).toEqual(["write_unverified", [1], [1, 2, 3], true]);
  });

  it("should_report_success_when_the_only_book_dropped_landed_and_was_then_refused", async () => {
    const r = await bulk([1], deps(scripted([RESET, FORBIDDEN]), "landed"));
    expect([r.isError ?? false, r.structuredContent?.applied, text(r)]).toEqual([
      false,
      [1],
      // #370 §Write path box 1: the success names the re-read that confirmed it
      "Applied tags to 1/1 book(s). Confirmed by a re-read: 1 (connection dropped).",
    ]);
  });
});

describe("retry count in the dropped-write steer (#370)", () => {
  it("should_say_after_1_retry_for_a_drop_then_timeout_in_bulk", async () => {
    const r = await bulk([1, 2], deps(scripted([RESET, TIMEOUT]), "unchanged"));
    expect(failedError(r)).toBe(
      "The connection to the Calibre Content Server dropped mid-request after 1 retry; the write " +
        "may have been committed — verify with calibre_get_book id=1 before retrying.",
    );
  });

  it("should_say_after_1_retry_for_a_drop_then_timeout_on_a_single_book", async () => {
    const r = await single(deps(scripted([RESET, TIMEOUT]), "unchanged"));
    expect(text(r)).toContain("dropped mid-request after 1 retry;");
  });

  it("should_still_say_after_2_retries_when_every_retry_ran", async () => {
    const r = await bulk([1, 2], deps(scripted([RESET, RESET, RESET]), "unchanged"));
    expect(failedError(r)).toContain("dropped mid-request after 2 retries;");
  });
});
