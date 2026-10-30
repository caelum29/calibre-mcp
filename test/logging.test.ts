// Agent-facing JSONL logger (#247): record shape, level filter, file sink + retention,
// per-call context, recent-error ring, and bounded field sizes.

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger, parseLevel, boundValue, type LogRecord } from "../src/logging.js";

const FIXED = new Date("2026-10-30T14:04:24.000Z");
const dirs: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "cmcp-log-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    chmodSync(d, 0o700);
    rmSync(d, { recursive: true, force: true });
  }
});

function setup(clock: { now: Date } = { now: FIXED }) {
  const lines: string[] = [];
  const logger = createLogger({ stderr: (s) => void lines.push(s), now: () => clock.now });
  const records = () => lines.map((l) => JSON.parse(l.replace(/^\[calibre-mcp\] /, "")) as LogRecord);
  return { logger, lines, records };
}

function jsonlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
}

describe("logger record shape", () => {
  it("should_write_one_prefixed_json_line_with_ts_lvl_msg_first", () => {
    const { logger, lines } = setup();
    logger.info("content server reachable", { libraries: 2 });
    expect(lines[0]).toMatch(
      /^\[calibre-mcp\] \{"ts":"2026-10-30T14:04:24.000Z","lvl":"info","msg":"content server reachable",/,
    );
  });

  it("should_carry_pid_and_meta_on_the_record", () => {
    const { logger, records } = setup();
    logger.info("content server reachable", { libraries: 2 });
    expect(records()[0]).toMatchObject({ pid: process.pid, meta: { libraries: 2 } });
  });
});

describe("logger level filter", () => {
  it("should_drop_debug_by_default", () => {
    const { logger, lines } = setup();
    logger.debug("evicted extract cache entry");
    expect(lines).toEqual([]);
  });

  it("should_drop_lines_under_the_configured_level", () => {
    const { logger, records } = setup();
    logger.configure({ level: "warn" });
    logger.info("noise");
    logger.warn("kept");
    expect(records().map((r) => r.msg)).toEqual(["kept"]);
  });
});

describe("logger call context", () => {
  it("should_tag_lines_inside_a_call_including_async_continuations", async () => {
    const { logger, records } = setup();
    logger.setClient("claude-code");
    await logger.withContext({ tool: "calibre_search", call: "c1" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      logger.error("calibredb failed");
    });
    expect(records()[0]).toMatchObject({ client: "claude-code", tool: "calibre_search", call: "c1" });
  });

  it("should_leave_lines_outside_a_call_untagged", () => {
    const { logger, records } = setup();
    logger.withContext({ tool: "t", call: "c1" }, () => undefined);
    logger.info("outside");
    expect(records()[0]!.call).toBeUndefined();
  });
});

describe("logger recent errors", () => {
  it("should_keep_only_the_last_20_errors_oldest_first", () => {
    const { logger } = setup();
    for (let i = 0; i < 25; i++) logger.error(`e${i}`);
    logger.warn("not an error");
    expect(logger.recentErrors().map((r) => r.msg)).toEqual(Array.from({ length: 20 }, (_, i) => `e${i + 5}`));
  });
});

describe("logger file sink", () => {
  it("should_append_to_the_daily_file_and_report_it_as_current", () => {
    const dir = tempDir();
    const { logger } = setup();
    logger.configure({ dir });
    logger.info("a");
    logger.error("b");
    const today = path.join(dir, "calibre-mcp-2026-10-30.jsonl");
    const msgs = readFileSync(today, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).msg);
    expect({ msgs, current: logger.currentFile() }).toEqual({ msgs: ["a", "b"], current: today });
  });

  it("should_write_a_schema_readme_into_the_dir", () => {
    const dir = tempDir();
    setup().logger.configure({ dir });
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toContain('msg:"tool call"');
  });

  it("should_keep_exactly_7_days_today_included", () => {
    const dir = tempDir();
    for (const d of ["2026-10-23", "2026-10-24", "2026-10-29"])
      writeFileSync(path.join(dir, `calibre-mcp-${d}.jsonl`), "{}\n");
    const { logger } = setup();
    logger.configure({ dir });
    logger.info("a");
    expect(jsonlFiles(dir)).toEqual([
      "calibre-mcp-2026-10-24.jsonl",
      "calibre-mcp-2026-10-29.jsonl",
      "calibre-mcp-2026-10-30.jsonl",
    ]);
  });

  it("should_prune_again_on_day_rollover_in_a_long_lived_process", () => {
    const dir = tempDir();
    const clock = { now: FIXED };
    const { logger } = setup(clock);
    logger.configure({ dir });
    logger.info("day one");
    clock.now = new Date("2026-11-06T00:00:01.000Z"); // 2026-10-30 is now 8 days back
    logger.info("a week later");
    expect(jsonlFiles(dir)).toEqual(["calibre-mcp-2026-11-06.jsonl"]);
  });

  it("should_keep_the_sink_when_an_old_file_cannot_be_deleted", () => {
    // A directory under an old log name stands in for losing an unlink race to another process.
    const dir = tempDir();
    mkdirSync(path.join(dir, "calibre-mcp-2026-10-01.jsonl"));
    const { logger } = setup();
    logger.configure({ dir });
    logger.info("still logged");
    expect(logger.currentFile()).toBe(path.join(dir, "calibre-mcp-2026-10-30.jsonl"));
  });

  it("should_warn_once_and_keep_stderr_when_the_file_sink_breaks", () => {
    const dir = tempDir();
    const { logger, lines } = setup();
    logger.configure({ dir });
    chmodSync(dir, 0o500); // read-only: append fails
    logger.info("one");
    logger.info("two");
    expect({
      warnings: lines.filter((l) => l.includes("log file sink disabled")).length,
      stderrKept: lines.some((l) => l.includes('"msg":"two"')),
      current: logger.currentFile(),
    }).toEqual({ warnings: 1, stderrKept: true, current: null });
  });
});

describe("boundValue", () => {
  it("should_cap_long_strings_with_a_visible_marker", () => {
    expect(boundValue("x".repeat(600))).toMatch(/^x{500}…\(\+100 chars\)$/);
  });

  it("should_cap_long_arrays_with_a_visible_marker", () => {
    const a = boundValue(Array.from({ length: 25 }, (_, i) => i)) as unknown[];
    expect(a.at(-1)).toBe("…(+5 items)");
  });

  it("should_flatten_errors_to_a_single_line_stack", () => {
    const e = boundValue(new Error("boom")) as { name: string; message: string; stack: string };
    expect({ name: e.name, message: e.message, multiline: e.stack.includes("\n") }).toEqual({
      name: "Error",
      message: "boom",
      multiline: false,
    });
  });
});

describe("parseLevel", () => {
  it("should_accept_known_levels_case_insensitively", () => {
    expect(parseLevel(" DEBUG ")).toBe("debug");
  });

  it("should_fall_back_to_info_for_unknown_or_missing", () => {
    expect([parseLevel("verbose"), parseLevel(undefined)]).toEqual(["info", "info"]);
  });
});
