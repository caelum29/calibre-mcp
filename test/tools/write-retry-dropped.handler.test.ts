// #233 follow-up — a connection dropped MID-REQUEST (reset / remote closed) can arrive after the
// server already committed, so an exhausted drop must read "may have been committed — verify",
// never a plain failure (the #33 rule). `connection refused` never reached the server.

import { describe, it, expect, vi } from "vitest";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/types.js";

// real calibre-server killed mid-request (probe 233-transient-stderr.md, follow-up)
const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const CLOSED = "http.client.RemoteDisconnected: Remote end closed connection without response";
const REFUSED = "urllib.error.URLError: <urlopen error [Errno 61] Connection refused>";
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

const deps = (calibredb: () => Promise<{ stdout: string; stderr: string }>): ToolDeps =>
  ({
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: async (id: number) => book(id),
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)] as const)),
    },
    calibre: { calibredb },
    sleep: async () => {},
    log,
  }) as unknown as ToolDeps;

const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
const failedError = (r: { structuredContent?: Record<string, unknown> }, id: number): string | undefined =>
  (r.structuredContent?.failed as { id: number; error: string }[] | undefined)?.find((f) => f.id === id)?.error;
const apply = (ids: number[]) => ({ changes: { tags: ["new"] }, ids, preview: false });

describe("calibre_bulk_update — dropped connection may have committed (#233)", () => {
  it("should_flag_a_reset_book_as_may_have_committed_in_structuredContent", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2]), deps(scripted([RESET, RESET, RESET])));
    expect(failedError(r, 1)).toContain(MAY(1));
  });

  it("should_flag_a_reset_book_as_may_have_committed_in_the_text", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2]), deps(scripted([RESET, RESET, RESET])));
    expect(text(r)).toContain(MAY(1));
  });

  it("should_still_trip_the_breaker_after_a_drop", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2]), deps(scripted([RESET, RESET, RESET])));
    expect([r.isError, r.structuredContent?.notAttempted]).toEqual([true, [2]]);
  });

  it("should_flag_a_remote_closed_book_mid_loop_in_both_channels", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps(scripted([null, CLOSED, CLOSED, CLOSED])));
    expect([failedError(r, 2)?.includes(MAY(2)), text(r).includes(MAY(2))]).toEqual([true, true]);
  });

  it("should_keep_plain_wording_when_the_last_error_was_connection_refused", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2]), deps(scripted([RESET, RESET, REFUSED])));
    expect(text(r)).not.toContain("may have been committed");
  });

  it("should_keep_plain_wording_for_a_refused_book", async () => {
    const r = await bulkUpdateTool.handler(apply([1, 2]), deps(scripted([REFUSED, REFUSED, REFUSED])));
    expect(failedError(r, 1)).not.toContain("may have been committed");
  });
});

describe("calibre_update_book — dropped connection may have committed (#233)", () => {
  const run = (outcomes: (string | null)[]) =>
    updateBookTool.handler({ id: 1, changes: { tags: ["new"] } }, deps(scripted(outcomes)));

  it("should_say_the_write_may_have_been_committed_after_an_exhausted_reset", async () => {
    const r = await run([RESET, RESET, RESET]);
    expect(text(r)).toContain(MAY(1));
  });

  it("should_say_the_write_may_have_been_committed_after_an_exhausted_remote_close", async () => {
    const r = await run([CLOSED, CLOSED, CLOSED]);
    expect(text(r)).toContain(MAY(1));
  });

  it("should_keep_plain_wording_when_the_server_refused_the_connection", async () => {
    const r = await run([REFUSED, REFUSED, REFUSED]);
    expect(text(r)).not.toContain("may have been committed");
  });
});
