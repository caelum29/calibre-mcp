// #389 §Observability: the recentErrors ring after eviction. A repeat of the oldest, already
// evicted error re-enters as a fresh entry (count 1, history lost), and errors whose meta
// strings differ only past the 500-char log cap collapse only when the capped marker matches.
// Checked at the logger and in both calibre_ping channels.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { createLogger, log } from "../../src/logging.js";
import type { AnyToolDescriptor } from "../../src/tools/types.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

const T0 = Date.parse("2026-11-05T00:00:00.000Z");
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

/** e0..e19 fill the ring, e20 evicts e0, then e0 comes back and evicts e1. */
function refillWithEvictedRepeat(logger: { error(msg: string, meta?: unknown): void }): void {
  for (let i = 0; i < 21; i++) err(logger, `e${i}`);
  err(logger, "e0");
}

describe("recentErrors: a repeat of an evicted error (#389)", () => {
  it("should_readd_the_evicted_error_as_a_fresh_entry_with_count_1_at_the_newest_position", () => {
    const logger = quiet();
    refillWithEvictedRepeat(logger);
    const recent = logger.recentErrors();
    expect(recent.map((r) => r.msg)).toEqual([...Array.from({ length: 19 }, (_, i) => `e${i + 2}`), "e0"]);
    expect(recent.map((r) => r.count)).toEqual(Array(19).fill(1).concat(1));
    expect(recent.at(-1)).toMatchObject({ msg: "e0", ts: at(21) });
    expect(recent.at(-1)!.firstTs).toBeUndefined(); // the first e0 was evicted: no history carried over
  });

  it("should_count_a_second_repeat_of_the_readded_error_from_1", () => {
    const logger = quiet();
    refillWithEvictedRepeat(logger);
    err(logger, "e0");
    const last = logger.recentErrors().at(-1)!;
    expect([last.msg, last.count, last.firstTs, last.ts]).toEqual(["e0", 2, at(21), at(22)]);
    expect(logger.recentErrors()).toHaveLength(20);
  });
});

function pingTool(): AnyToolDescriptor {
  const t = allTools.find((x) => x.name === "calibre_ping");
  if (!t) throw new Error("calibre_ping is not in the registry");
  return t;
}

const stores: SqliteIndexStore[] = [];
afterEach(() => {
  for (const st of stores.splice(0)) st.close();
});

function pingDeps(): ToolDeps {
  const index = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  stores.push(index);
  return {
    config: loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: { resolveLibraryId: async () => "Programming_Books" } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "category,count\ntags,12" } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } satisfies Partial<ToolDeps["embedder"]> as ToolDeps["embedder"],
    index,
    log,
  };
}

const textOf = (r: { content: Array<{ type: string; text?: string }> }): string =>
  r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

describe("calibre_ping after an evicted error returns (#389)", () => {
  it("should_show_20_entries_without_an_occurrences_suffix_and_the_readded_one_newest_in_both_channels", async () => {
    // the process logger, which calibre_ping reads (this file starts with an empty ring)
    refillWithEvictedRepeat(log);
    const r = await pingTool().handler({}, pingDeps());
    const sc = r.structuredContent as { recentErrors: Array<{ msg: string; count: number; firstTs?: string }> };
    expect(sc.recentErrors.map((e) => [e.msg, e.count])).toEqual([
      ...Array.from({ length: 19 }, (_, i) => [`e${i + 2}`, 1]),
      ["e0", 1],
    ]);
    const text = textOf(r);
    const lines = text.split("\n");
    expect(lines).toContain("recent errors: 20"); // 20 entries, 20 occurrences: no suffix
    expect(text).not.toContain("occurrences");
    expect(lines.filter((l) => l.startsWith("- ")).map((l) => l.split(" ")[2])).toEqual(
      ["e0", ...Array.from({ length: 19 }, (_, i) => `e${20 - i}`)], // newest first
    );
    expect(text).not.toContain("×"); // a count of 1 carries no repeat marker

    err(log, "e0"); // a further repeat now has 2 occurrences in a 20-entry ring
    const again = textOf(await pingTool().handler({}, pingDeps()));
    expect(again).toContain("recent errors: 20 (21 occurrences)");
    expect(again).toContain(`e0 (×2 since ${at(21)})`);
  });
});

describe("recentErrors: meta strings past the 500-char cap (#389)", () => {
  const long = (tail: string) => "x".repeat(500) + tail;

  it("should_collapse_two_errors_whose_strings_have_the_same_length_and_differ_only_after_char_500", () => {
    const logger = quiet();
    err(logger, "extract failed", { detail: long("AAAA") });
    err(logger, "extract failed", { detail: long("BBBB") });
    const [only, ...rest] = logger.recentErrors();
    expect(rest).toEqual([]);
    expect(only!.count).toBe(2);
    expect(only!.meta).toEqual({ detail: `${"x".repeat(500)}…(+4 chars)` }); // the cap hides the difference
  });

  it("should_keep_them_apart_when_the_cut_tails_differ_in_length", () => {
    const logger = quiet();
    err(logger, "extract failed", { detail: long("AAAA") });
    err(logger, "extract failed", { detail: long("BBBBB") });
    expect(logger.recentErrors().map((r) => [r.count, r.meta])).toEqual([
      [1, { detail: `${"x".repeat(500)}…(+4 chars)` }],
      [1, { detail: `${"x".repeat(500)}…(+5 chars)` }],
    ]);
  });

  it("should_keep_them_apart_when_the_difference_is_within_the_first_500_chars", () => {
    const logger = quiet();
    err(logger, "extract failed", { detail: "a" + "x".repeat(600) });
    err(logger, "extract failed", { detail: "b" + "x".repeat(600) });
    expect(logger.recentErrors().map((r) => r.count)).toEqual([1, 1]);
  });
});
