// #370 §Observability: a burst of one repeated error collapses into one recentErrors entry with
// a count (and its first time), so it can't push older distinct errors out of the 20-slot ring.
// Key = msg + tool + meta minus per-call timing/correlation fields; a book id or message
// difference keeps errors apart. Checked in both calibre_ping channels.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { createLogger, log } from "../../src/logging.js";
import type { AnyToolDescriptor } from "../../src/tools/types.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

const T0 = Date.parse("2026-11-04T00:00:00.000Z");
const at = (s: number): string => new Date(T0 + s * 1000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

/** Log one error, then move the clock 1 s. */
function err(logger: { error(msg: string, meta?: unknown): void }, msg: string, meta?: unknown): void {
  logger.error(msg, meta);
  vi.advanceTimersByTime(1000);
}

const quiet = () => createLogger({ stderr: () => {} });

describe("recentErrors collapses repeats (#370)", () => {
  it("should_keep_3_older_distinct_errors_visible_after_25_copies_of_one_error", () => {
    const logger = quiet();
    err(logger, "A");
    err(logger, "B");
    err(logger, "C");
    for (let i = 0; i < 25; i++) err(logger, "X", { bookId: 7 });
    expect(logger.recentErrors().map((r) => [r.msg, r.count, r.firstTs, r.ts])).toEqual([
      ["A", 1, undefined, at(0)],
      ["B", 1, undefined, at(1)],
      ["C", 1, undefined, at(2)],
      ["X", 25, at(3), at(27)],
    ]);
  });

  it("should_not_collapse_errors_that_differ_only_in_book_id", () => {
    const logger = quiet();
    err(logger, "extraction failed", { bookId: 1 });
    err(logger, "extraction failed", { bookId: 2 });
    expect(logger.recentErrors().map((r) => [r.meta, r.count])).toEqual([
      [{ bookId: 1 }, 1],
      [{ bookId: 2 }, 1],
    ]);
  });

  it("should_not_collapse_errors_that_differ_only_in_message", () => {
    const logger = quiet();
    err(logger, "calibredb failed", { code: 1 });
    err(logger, "calibredb crashed", { code: 1 });
    expect(logger.recentErrors().map((r) => [r.msg, r.count])).toEqual([
      ["calibredb failed", 1],
      ["calibredb crashed", 1],
    ]);
  });

  it("should_not_collapse_the_same_error_from_two_tools", () => {
    const logger = quiet();
    logger.withContext({ tool: "calibre_search", call: "c1" }, () => err(logger, "boom"));
    logger.withContext({ tool: "calibre_get_book", call: "c2" }, () => err(logger, "boom"));
    expect(logger.recentErrors().map((r) => [r.tool, r.count])).toEqual([
      ["calibre_search", 1],
      ["calibre_get_book", 1],
    ]);
  });

  it("should_collapse_tool_call_lines_that_differ_only_in_timing_and_correlation_ids", () => {
    const logger = quiet();
    const meta = (ms: number, rpc: number) => ({
      durationMs: ms,
      rpcId: rpc,
      traceId: `t${rpc}`,
      parentSpanId: `s${rpc}`,
      isError: true,
      errorCode: "calibre_unreachable",
      args: { query: "x" },
    });
    logger.withContext({ tool: "calibre_search", call: "c1" }, () => err(logger, "tool call", meta(12, 1)));
    logger.withContext({ tool: "calibre_search", call: "c2" }, () => err(logger, "tool call", meta(40, 2)));
    const [only, ...rest] = logger.recentErrors();
    expect(rest).toEqual([]);
    // the newest occurrence's details, so `call` is the one to grep for
    expect(only).toMatchObject({
      msg: "tool call",
      tool: "calibre_search",
      call: "c2",
      count: 2,
      firstTs: at(0),
      ts: at(1),
    });
    expect(only!.meta).toEqual(meta(40, 2));
  });

  it("should_move_a_repeat_to_the_newest_position", () => {
    const logger = quiet();
    err(logger, "A");
    err(logger, "B");
    err(logger, "A");
    expect(logger.recentErrors().map((r) => [r.msg, r.count])).toEqual([
      ["B", 1],
      ["A", 2],
    ]);
  });

  it("should_keep_18_distinct_errors_through_an_interleaved_two_error_burst", () => {
    const logger = quiet();
    for (let i = 0; i < 18; i++) err(logger, `d${i}`);
    for (let i = 0; i < 10; i++) {
      err(logger, "X");
      err(logger, "Y");
    }
    const recent = logger.recentErrors();
    expect(recent.map((r) => r.msg)).toEqual([...Array.from({ length: 18 }, (_, i) => `d${i}`), "X", "Y"]);
    expect(recent.slice(-2).map((r) => r.count)).toEqual([10, 10]);
  });

  it("should_still_drop_the_oldest_when_more_than_20_distinct_errors_arrive", () => {
    const logger = quiet();
    for (let i = 0; i < 21; i++) err(logger, `e${i}`, { i });
    err(logger, "e20", { i: 20 }); // a repeat of the newest doesn't bring e0 back
    const recent = logger.recentErrors();
    expect(recent.map((r) => r.msg)).toEqual(Array.from({ length: 20 }, (_, i) => `e${i + 1}`));
    expect(recent.at(-1)!.count).toBe(2);
  });
});

function pingTool(): AnyToolDescriptor {
  const t = allTools.find((x) => x.name === "calibre_ping");
  if (!t) throw new Error("calibre_ping is not in the registry");
  return t;
}

function pingDeps(): ToolDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: { resolveLibraryId: async () => "Programming_Books" } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "category,count\ntags,12" } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } satisfies Partial<ToolDeps["embedder"]> as ToolDeps["embedder"],
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
}

describe("calibre_ping shows a collapsed burst in both channels (#370)", () => {
  it("should_list_all_4_errors_with_the_burst_count_in_text_and_structuredContent", async () => {
    // the process logger: what calibre_ping reads (this file starts with an empty ring)
    err(log, "burst A");
    err(log, "burst B");
    err(log, "burst C");
    for (let i = 0; i < 25; i++) err(log, "burst X", { bookId: 7 });

    const r = await pingTool().handler({}, pingDeps());
    const sc = r.structuredContent as {
      recentErrors: Array<{ msg: string; ts: string; count: number; firstTs?: string }>;
    };
    expect(sc.recentErrors.map((e) => [e.msg, e.count, e.firstTs, e.ts])).toEqual([
      ["burst A", 1, undefined, at(0)],
      ["burst B", 1, undefined, at(1)],
      ["burst C", 1, undefined, at(2)],
      ["burst X", 25, at(3), at(27)],
    ]);

    const text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    expect(text).toContain("recent errors: 4 (28 occurrences)");
    expect(text).toContain(`- ${at(27)} burst X {"bookId":7} (×25 since ${at(3)})`);
    expect(text.split("\n")).toContain(`- ${at(0)} burst A`); // a single occurrence carries no count
  });
});
