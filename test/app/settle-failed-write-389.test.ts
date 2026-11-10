// settleFailedWrite (#390) outcome table, unit level (#389): the one mapping from a failed routed
// write's error (+ a re-read when it may have committed) to the outcome both write tools render.

import { describe, expect, it, vi } from "vitest";
import { settleFailedWrite, withTransientRetry, type TimedOutWrite } from "../../src/app/write-policy.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { Book } from "../../src/domain/book.js";
import type { BaseDeps } from "../../src/tools/deps.js";

const book = (publisher?: string): Book => ({
  id: 1,
  uuid: "u",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: [],
  tags: [],
  languages: [],
  ...(publisher === undefined ? {} : { publisher }),
});

const WRITE: TimedOutWrite = { id: 1, before: book("Old"), changes: { publisher: "New" } };
const LANDED = book("New");
const NOT_LANDED = book("Old");
const FOREIGN = book("GUI");

const cli = (stderr: string) => new CalibreCliError(1, "calibredb command failed", stderr);
const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const REFUSED = "HTTP Error 403: Forbidden";

/** Deps whose re-read returns `after` (or throws it); `getBook` counts the re-reads. */
function deps(after: Book | Error) {
  const getBook = vi.fn(async () => {
    if (after instanceof Error) throw after;
    return after;
  });
  return { deps: { content: { getBook } } as unknown as BaseDeps, getBook };
}

/** The error withTransientRetry throws when attempt 1 drops mid-request and attempt 2 is refused. */
async function droppedThenRefused(): Promise<unknown> {
  const errs = [cli(RESET), cli(REFUSED)];
  let n = 0;
  return withTransientRetry(
    async () => {
      throw errs[n++]!;
    },
    async () => {},
  ).catch((e: unknown) => e);
}

describe("settleFailedWrite — outcome table (#389)", () => {
  it("should_confirm_a_dropped_write_the_re_read_shows", async () => {
    const { deps: d } = deps(LANDED);
    expect(await settleFailedWrite(d, WRITE, cli(RESET))).toEqual({
      kind: "confirmed",
      cause: "dropped",
      after: LANDED,
    });
  });

  it("should_leave_a_dropped_write_unverified_when_the_re_read_shows_the_old_value", async () => {
    const { deps: d } = deps(NOT_LANDED);
    expect(await settleFailedWrite(d, WRITE, cli(RESET))).toEqual({
      kind: "unverified",
      cause: "dropped",
      check: { status: "not-landed" },
    });
  });

  it("should_confirm_a_drop_then_refusal_the_re_read_shows", async () => {
    const { deps: d } = deps(LANDED);
    expect(await settleFailedWrite(d, WRITE, await droppedThenRefused())).toEqual({
      kind: "refusedAfterLanding",
      cause: "dropped",
      after: LANDED,
    });
  });

  it("should_answer_refused_for_a_drop_then_refusal_that_did_not_land", async () => {
    const { deps: d } = deps(NOT_LANDED);
    expect(await settleFailedWrite(d, WRITE, await droppedThenRefused())).toEqual({ kind: "refused" });
  });

  it("should_leave_a_drop_then_refusal_unverified_when_the_re_read_shows_a_third_value", async () => {
    const { deps: d } = deps(FOREIGN);
    expect(await settleFailedWrite(d, WRITE, await droppedThenRefused())).toEqual({
      kind: "refusedUnverified",
      cause: "dropped",
      check: { status: "unverifiable", foreign: [{ field: "publisher", after: "GUI", intended: "New" }] },
    });
  });

  it("should_answer_a_plain_refusal_without_a_re_read", async () => {
    const { deps: d, getBook } = deps(LANDED);
    expect([await settleFailedWrite(d, WRITE, cli(REFUSED)), getBook.mock.calls.length]).toEqual([
      { kind: "refused" },
      0,
    ]);
  });

  it("should_classify_a_refused_connection_and_a_gateway_5xx_as_transient_without_a_re_read", async () => {
    const { deps: d, getBook } = deps(LANDED);
    const refusedConn = await settleFailedWrite(d, WRITE, cli("ConnectionRefusedError: [Errno 61] Connection refused"));
    const gateway = await settleFailedWrite(d, WRITE, cli("HTTP Error 503: Service Unavailable"));
    expect([refusedConn, gateway, getBook.mock.calls.length]).toEqual([
      { kind: "transient", transient: "connection" },
      { kind: "transient", transient: "server" },
      0,
    ]);
  });

  it("should_confirm_a_timed_out_write_the_re_read_shows", async () => {
    const { deps: d } = deps(LANDED);
    expect(await settleFailedWrite(d, WRITE, new CalibreCliTimeoutError("t"))).toEqual({
      kind: "confirmed",
      cause: "timeout",
      after: LANDED,
    });
  });

  it("should_leave_a_timed_out_write_unverified_when_the_re_read_shows_the_old_value", async () => {
    const { deps: d } = deps(NOT_LANDED);
    expect(await settleFailedWrite(d, WRITE, new CalibreCliTimeoutError("t"))).toEqual({
      kind: "unverified",
      cause: "timeout",
      check: { status: "not-landed" },
    });
  });

  it("should_leave_a_timed_out_write_unverified_when_the_re_read_shows_a_third_value", async () => {
    const { deps: d } = deps(FOREIGN);
    expect(await settleFailedWrite(d, WRITE, new CalibreCliTimeoutError("t"))).toEqual({
      kind: "unverified",
      cause: "timeout",
      check: { status: "unverifiable", foreign: [{ field: "publisher", after: "GUI", intended: "New" }] },
    });
  });

  it("should_leave_a_timed_out_write_unverifiable_when_the_re_read_fails", async () => {
    const { deps: d } = deps(new Error("server gone"));
    expect(await settleFailedWrite(d, WRITE, new CalibreCliTimeoutError("t"))).toEqual({
      kind: "unverified",
      cause: "timeout",
      check: { status: "unverifiable" },
    });
  });

  it("should_answer_unexpected_for_any_other_error_without_a_re_read", async () => {
    const { deps: d, getBook } = deps(LANDED);
    const outcomes = [
      await settleFailedWrite(d, WRITE, cli("Traceback: ValueError: bad field")),
      await settleFailedWrite(d, WRITE, new Error("boom")),
      await settleFailedWrite(d, WRITE, "a string"),
    ];
    expect([outcomes, getBook.mock.calls.length]).toEqual([
      [{ kind: "unexpected" }, { kind: "unexpected" }, { kind: "unexpected" }],
      0,
    ]);
  });
});
