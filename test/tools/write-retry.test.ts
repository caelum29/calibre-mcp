// Unit tests for the #233 transient-retry helper plus exact-text checks on the bulk breaker
// result, closing gaps found by mutation testing of app/write-policy.ts (retry) / calibre_bulk_update.ts.

import { afterEach, describe, it, expect, vi } from "vitest";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { classifyTransient, describeTransient, realSleep, withTransientRetry } from "../../src/app/write-policy.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";

const REFUSED = "urllib.error.URLError: <urlopen error [Errno 61] Connection refused>";
const cli = (stderr?: string) => new CalibreCliError(1, "calibredb command failed", stderr);

describe("realSleep", () => {
  afterEach(() => vi.useRealTimers());

  it("should_resolve_only_after_the_given_delay", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = realSleep(1000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });
});

describe("classifyTransient", () => {
  it("should_ignore_a_non_calibredb_error_even_with_matching_text", () => {
    expect(classifyTransient({ stderr: REFUSED })).toBeUndefined();
  });

  it("should_ignore_a_calibredb_error_without_stderr", () => {
    expect(classifyTransient(cli())).toBeUndefined();
  });

  it("should_classify_connection_and_gateway_errors", () => {
    expect([classifyTransient(cli(REFUSED)), classifyTransient(cli("HTTP Error 502: Bad Gateway"))]).toEqual([
      "connection",
      "server",
    ]);
  });
});

describe("withTransientRetry", () => {
  it("should_rethrow_the_last_transient_error_after_two_retries", async () => {
    const fn = vi.fn(async () => {
      throw cli(REFUSED);
    });
    await expect(withTransientRetry(fn, async () => {})).rejects.toBeInstanceOf(CalibreCliError);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("describeTransient", () => {
  it("should_tell_the_model_to_check_the_server_on_a_connection_error", () => {
    expect(describeTransient(cli(REFUSED), 1)).toBe(
      "Could not reach the Calibre Content Server (connection refused or dropped) after 2 retries. " +
        "Check that Calibre / its Content Server is running, then retry.",
    );
  });

  it("should_name_the_gateway_status", () => {
    expect(describeTransient(cli("HTTP Error 504: Gateway Timeout"), 1)).toBe(
      "The Calibre Content Server answered HTTP 504 after 2 retries; it may be restarting — retry shortly.",
    );
  });

  it("should_fall_back_to_5xx_when_no_status_is_present", () => {
    expect(describeTransient(cli("garbage"), 1)).toContain("HTTP 5xx after 2 retries");
  });
});

describe("calibre_bulk_update breaker text (#233)", () => {
  const book = (id: number): Book => ({
    id,
    uuid: `u${id}`,
    title: "T",
    authors: ["A"],
    identifiers: {},
    formats: ["pdf"],
    tags: ["old"],
    languages: ["en"],
  });
  const deps = (calibredb: () => Promise<{ stdout: string; stderr: string }>): BaseDeps =>
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
    }) as unknown as BaseDeps;
  const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

  it("should_render_the_breaker_result_exactly_when_nothing_committed", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps(async () => {
        throw cli(REFUSED);
      }),
    );
    expect(text(r)).toBe(
      "Error: Stopped: the Calibre Content Server is unreachable after 0/2 book(s) were already updated. " +
        "Failed: 1. Not attempted: 2. " +
        "Could not reach the Calibre Content Server (connection refused or dropped) after 2 retries. " +
        "Check that Calibre / its Content Server is running, then retry. Once it is back, re-run with ids=[1,2].",
    );
  });

  it("should_render_the_breaker_result_exactly_when_the_last_book_trips_it", async () => {
    let call = 0;
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps(async () => {
        call += 1;
        if (call > 1) throw cli(REFUSED);
        return { stdout: "", stderr: "" };
      }),
    );
    expect(text(r)).toBe(
      "Error: Stopped: the Calibre Content Server is unreachable after 1/2 book(s) were already updated. " +
        "Already committed: 1. Failed: 2. " +
        "Could not reach the Calibre Content Server (connection refused or dropped) after 2 retries. " +
        "Check that Calibre / its Content Server is running, then retry. Once it is back, re-run with ids=[2].",
    );
  });

  it("should_keep_the_refusal_headline_for_a_mid_loop_refusal", async () => {
    let call = 0;
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps(async () => {
        call += 1;
        if (call > 1) throw cli("Forbidden");
        return { stdout: "", stderr: "" };
      }),
    );
    expect(text(r)).toMatch(/^Error: Calibre refused the write after 1\/2 book\(s\) were already updated\. /);
  });

  // nothing committed → nothing to protect; keep the plain refusal (no partial result)
  it("should_return_the_bare_refusal_without_a_partial_result_when_the_first_book_is_refused", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps(async () => {
        throw cli("Forbidden");
      }),
    );
    // only the code, hint and mirrored steer (#249), no applied/failed ledger
    expect(r.structuredContent).toEqual({
      errorCode: "write_refused",
      error: expect.stringContaining("Calibre refused the write"),
      hint: expect.any(String),
    });
  });

  // #249 review: a stopped loop carries the cause's code, not a blanket write_failed
  it("should_code_a_connection_stop_as_calibre_unreachable", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps(async () => {
        throw cli(REFUSED);
      }),
    );
    expect(r.structuredContent?.errorCode).toBe("calibre_unreachable");
  });

  it("should_code_a_mid_loop_refusal_as_write_refused", async () => {
    let call = 0;
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
      deps(async () => {
        call += 1;
        if (call > 1) throw cli("Forbidden");
        return { stdout: "", stderr: "" };
      }),
    );
    expect(r.structuredContent?.errorCode).toBe("write_refused");
  });
});
