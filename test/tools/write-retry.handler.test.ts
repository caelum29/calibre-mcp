// Issue #233 — transient calibredb failures on idempotent set_metadata writes are retried
// (2 retries, 1 s then 3 s), connection-class exhaustion trips a bulk circuit breaker, and
// 401/403, 500 and timeouts are never retried. stderr fixtures are the probed calibredb output.

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/types.js";

// Tails of the real calibredb 9.x stderr, captured by the #233 probe (frames trimmed).
const STDERR = {
  refused:
    "Traceback (most recent call last):\n" +
    "ConnectionRefusedError: [Errno 61] Connection refused\n\n" +
    "During handling of the above exception, another exception occurred:\n\n" +
    "Traceback (most recent call last):\n" +
    "urllib.error.URLError: <urlopen error [Errno 61] Connection refused>\nIntegration status: False",
  reset:
    "Traceback (most recent call last):\n" +
    "ConnectionResetError: [Errno 54] Connection reset by peer\n\n" +
    "urllib.error.URLError: <urlopen error [Errno 54] Connection reset by peer>",
  disconnected:
    "Traceback (most recent call last):\n" +
    "http.client.RemoteDisconnected: Remote end closed connection without response\n\n" +
    "urllib.error.URLError: <urlopen error Remote end closed connection without response>",
  http502:
    "Traceback (most recent call last):\n" +
    "mechanize._response.get_seek_wrapper_class.<locals>.httperror_seek_wrapper: HTTP Error 502: Bad Gateway",
  http503:
    "Traceback (most recent call last):\n" +
    "mechanize._response.get_seek_wrapper_class.<locals>.httperror_seek_wrapper: HTTP Error 503: Service Unavailable",
  http504:
    "Traceback (most recent call last):\n" +
    "mechanize._response.get_seek_wrapper_class.<locals>.httperror_seek_wrapper: HTTP Error 504: Gateway Timeout",
  http500:
    "Traceback (most recent call last):\n" +
    "mechanize._response.get_seek_wrapper_class.<locals>.httperror_seek_wrapper: HTTP Error 500: Internal Server Error",
  forbidden: "Forbidden\nIntegration status: False",
} as const;

type Outcome = keyof typeof STDERR | "timeout" | null;

const cliError = (kind: Outcome): Error =>
  kind === "timeout"
    ? new CalibreCliTimeoutError("calibredb command timed out")
    : new CalibreCliError(1, "calibredb command failed", STDERR[kind as keyof typeof STDERR]);

/** calibredb fake: call N gets outcomes[N-1] (null or past the end = success). */
const scripted = (outcomes: Outcome[]) => {
  const spy = vi.fn(async (_args: readonly string[]) => {
    const outcome = outcomes[spy.mock.calls.length - 1];
    if (outcome) throw cliError(outcome);
    return { stdout: "", stderr: "" };
  });
  return spy;
};

const fakeSleep = () => vi.fn(async (_ms: number) => {});

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
  calibredb: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  sleep: (ms: number) => Promise<void>;
  getBook?: (id: number) => Promise<Book>;
}

function deps(opts: FakeOpts): ToolDeps {
  const fixture = opts.fixture ?? [book({ id: 1 }), book({ id: 2 }), book({ id: 3 })];
  const byId = new Map(fixture.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books",
    getBook: opts.getBook ?? (async (id: number): Promise<Book> => byId.get(id) ?? book({ id })),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb: opts.calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    sleep: opts.sleep,
    log,
  };
}

const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
const failedIds = (r: { structuredContent?: Record<string, unknown> }): number[] =>
  ((r.structuredContent?.failed as { id: number }[] | undefined) ?? []).map((f) => f.id);
const apply = (ids: number[]) => ({ changes: { tags: ["new"] }, ids, preview: false });

describe("calibre_bulk_update transient retry (#233)", () => {
  it("applies a book after 1 retry on connection refused, pausing 1 s", async () => {
    const spy = scripted(["refused"]);
    const sleep = fakeSleep();
    const r = await bulkUpdateTool.handler(apply([1]), deps({ calibredb: spy, sleep }));
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[1000]]);
    expect(r.structuredContent?.applied).toEqual([1]);
    expect(r.structuredContent?.failed).toEqual([]);
  });

  it("applies a book after 2 retries on a 503, pausing 1 s then 3 s", async () => {
    const spy = scripted(["http503", "http503"]);
    const sleep = fakeSleep();
    const r = await bulkUpdateTool.handler(apply([1]), deps({ calibredb: spy, sleep }));
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
    expect(r.structuredContent?.applied).toEqual([1]);
  });

  it("retries the same set_metadata argv each time", async () => {
    const spy = scripted(["reset"]);
    await bulkUpdateTool.handler(apply([1]), deps({ calibredb: spy, sleep: fakeSleep() }));
    expect(spy.mock.calls[0]![0]).toEqual(["set_metadata", "1", "--field", "tags:new"]);
    expect(spy.mock.calls[1]![0]).toEqual(["set_metadata", "1", "--field", "tags:new"]);
  });

  it("retries a mid-request server death (remote end closed the connection)", async () => {
    const spy = scripted(["disconnected"]);
    const r = await bulkUpdateTool.handler(apply([1]), deps({ calibredb: spy, sleep: fakeSleep() }));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.structuredContent?.applied).toEqual([1]);
  });

  it("gives up after 2 retries and trips the circuit breaker on a connection-class error", async () => {
    const spy = scripted(["refused", "refused", "refused"]);
    const sleep = fakeSleep();
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps({ calibredb: spy, sleep }));
    expect(r.isError).toBe(true);
    // 1 try + 2 retries on book 1, then the loop stops — books 2 and 3 are never written
    expect(spy).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
    expect(r.structuredContent?.applied).toEqual([]);
    expect(failedIds(r)).toEqual([1]);
    expect(r.structuredContent?.notAttempted).toEqual([2, 3]);
    expect(r.structuredContent?.retryIds).toEqual([1, 2, 3]);
    expect(text(r)).toContain("Not attempted: 2, 3.");
    expect(text(r)).toContain("re-run with ids=[1,2,3]");
  });

  it("keeps committed books visible when the breaker trips mid-loop, in both channels", async () => {
    const spy = scripted([null, "reset", "reset", "refused"]);
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps({ calibredb: spy, sleep: fakeSleep() }));
    expect(r.isError).toBe(true);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(r.structuredContent?.applied).toEqual([1]);
    expect(failedIds(r)).toEqual([2]);
    expect(r.structuredContent?.notAttempted).toEqual([3]);
    expect(r.structuredContent?.retryIds).toEqual([2, 3]);
    expect(text(r)).toContain("Already committed: 1.");
    expect(text(r)).toContain("Failed: 2.");
    expect(text(r)).toContain("Not attempted: 3.");
    expect(text(r)).toContain("re-run with ids=[2,3]");
    // a down server is not a permissions problem — don't steer to --enable-local-write
    expect(text(r)).not.toContain("--enable-local-write");
    const schema = z.object(bulkUpdateTool.outputSchema!);
    expect(schema.safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success).toBe(true);
  });

  it("leaves earlier per-book failures out of retryIds when the breaker trips", async () => {
    // book 1: HTTP 500 (own failure, not retried); book 2: server down
    const spy = scripted(["http500", "refused", "refused", "refused"]);
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps({ calibredb: spy, sleep: fakeSleep() }));
    expect(failedIds(r)).toEqual([1, 2]);
    expect(r.structuredContent?.retryIds).toEqual([2, 3]);
  });

  it("fails only the one book on an exhausted 5xx and keeps looping", async () => {
    const spy = scripted([null, "http502", "http502", "http502"]);
    const sleep = fakeSleep();
    const r = await bulkUpdateTool.handler(apply([1, 2, 3]), deps({ calibredb: spy, sleep }));
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
    expect(r.structuredContent?.applied).toEqual([1, 3]);
    expect(failedIds(r)).toEqual([2]);
    expect(r.structuredContent?.notAttempted).toBeUndefined();
    expect(text(r)).toContain("#2:");
    expect(text(r)).toContain("HTTP 502");
  });

  it("never retries a 403 refusal", async () => {
    const spy = scripted(["forbidden"]);
    const sleep = fakeSleep();
    const r = await bulkUpdateTool.handler(apply([1, 2]), deps({ calibredb: spy, sleep }));
    expect(r.isError).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(text(r)).toContain("--enable-local-write");
  });

  it("never retries a 500 — the book fails once and the loop continues", async () => {
    const spy = scripted(["http500"]);
    const sleep = fakeSleep();
    const r = await bulkUpdateTool.handler(apply([1, 2]), deps({ calibredb: spy, sleep }));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
    expect(failedIds(r)).toEqual([1]);
    expect(r.structuredContent?.applied).toEqual([2]);
  });

  it("never retries a timeout — the #33 re-read verify path decides", async () => {
    const spy = scripted(["timeout"]);
    const sleep = fakeSleep();
    const r = await bulkUpdateTool.handler(
      apply([1]),
      deps({ fixture: [book({ id: 1 })], calibredb: spy, sleep, getBook: async () => book({ id: 1, tags: ["new"] }) }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(r.structuredContent?.applied).toEqual([1]);
  });

  it("sends a retry that times out to the #33 verify path, not another retry", async () => {
    const spy = scripted(["refused", "timeout"]);
    const sleep = fakeSleep();
    const r = await bulkUpdateTool.handler(apply([1]), deps({ fixture: [book({ id: 1 })], calibredb: spy, sleep }));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[1000]]);
    const failed = r.structuredContent?.failed as { id: number; error: string }[];
    expect(failed[0]?.error).toContain("calibre_get_book id=1");
  });
});

describe("calibre_update_book transient retry (#233)", () => {
  const one = [book({ id: 1 })];
  // update_book re-reads the book after writing; serve "before" then "after"
  const seqGetBook = () => {
    const seq = [book({ id: 1 }), book({ id: 1, tags: ["new"] })];
    return async (): Promise<Book> => seq.shift() ?? book({ id: 1, tags: ["new"] });
  };
  const run = (calibredb: FakeOpts["calibredb"], sleep: FakeOpts["sleep"]) =>
    updateBookTool.handler(
      { id: 1, changes: { tags: ["new"] } },
      deps({ fixture: one, calibredb, sleep, getBook: seqGetBook() }),
    );

  it("succeeds after 1 retry on connection refused", async () => {
    const spy = scripted(["refused"]);
    const sleep = fakeSleep();
    const r = await run(spy, sleep);
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[1000]]);
    expect(r.structuredContent?.changed).toEqual([{ field: "tags", before: ["old"], after: ["new"] }]);
  });

  it("succeeds after 2 retries on a 504", async () => {
    const spy = scripted(["http504", "http504"]);
    const sleep = fakeSleep();
    const r = await run(spy, sleep);
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
  });

  it("gives up after 2 retries when the server stays unreachable", async () => {
    const spy = scripted(["refused", "refused", "refused"]);
    const r = await run(spy, fakeSleep());
    expect(r.isError).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(text(r)).toContain("after 2 retries");
    expect(text(r)).not.toContain("--enable-local-write");
  });

  it("gives up after 2 retries on a persistent 503 and names the status", async () => {
    const spy = scripted(["http503", "http503", "http503"]);
    const r = await run(spy, fakeSleep());
    expect(r.isError).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(text(r)).toContain("HTTP 503");
  });

  it("never retries a 403 refusal", async () => {
    const spy = scripted(["forbidden"]);
    const sleep = fakeSleep();
    const r = await run(spy, sleep);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(text(r)).toContain("--enable-local-write");
  });

  it("never retries a 500", async () => {
    const spy = scripted(["http500"]);
    const sleep = fakeSleep();
    const r = await run(spy, sleep);
    expect(r.isError).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never retries a timeout — the #33 verify path confirms the landed write", async () => {
    const spy = scripted(["timeout"]);
    const sleep = fakeSleep();
    const r = await run(spy, sleep);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.changed).toEqual([{ field: "tags", before: ["old"], after: ["new"] }]);
  });
});
