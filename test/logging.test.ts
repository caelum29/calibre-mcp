// Agent-facing JSONL logger (#247): record shape, level filter, file sink + retention,
// per-call context, recent-error ring, and bounded field sizes.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger, parseLevel, boundValue, type LogRecord } from "../src/logging.js";

const FIXED = new Date("2026-10-30T14:04:24.000Z");

function setup() {
  const lines: string[] = [];
  const logger = createLogger({ stderr: (s) => void lines.push(s), now: () => FIXED });
  const records = () => lines.map((l) => JSON.parse(l.replace(/^\[calibre-mcp\] /, "")) as LogRecord);
  return { logger, lines, records };
}

describe("logger", () => {
  it("writes one prefixed JSON line per event with fixed leading keys", () => {
    const { logger, lines, records } = setup();
    logger.info("content server reachable", { libraries: 2 });
    expect(lines[0]).toMatch(/^\[calibre-mcp\] \{"ts":"2026-10-30T14:04:24.000Z","lvl":"info","msg":/);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    expect(records()[0]).toMatchObject({ msg: "content server reachable", pid: process.pid, meta: { libraries: 2 } });
  });

  it("drops lines under the configured level (default info)", () => {
    const { logger, records } = setup();
    logger.debug("evicted extract cache entry");
    logger.configure({ level: "warn" });
    logger.info("noise");
    logger.warn("kept");
    expect(records().map((r) => r.msg)).toEqual(["kept"]);
  });

  it("tags every line inside a call with tool + call, including async continuations", async () => {
    const { logger, records } = setup();
    logger.setClient("claude-code");
    await logger.withContext({ tool: "calibre_search", call: "c1" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      logger.error("calibredb failed");
    });
    logger.info("outside");
    const [inner, outer] = records();
    expect(inner).toMatchObject({ client: "claude-code", tool: "calibre_search", call: "c1" });
    expect(outer!.call).toBeUndefined();
  });

  it("keeps the last 20 errors for ping", () => {
    const { logger } = setup();
    for (let i = 0; i < 25; i++) logger.error(`e${i}`);
    logger.warn("not an error");
    const recent = logger.recentErrors();
    expect(recent).toHaveLength(20);
    expect(recent[0]!.msg).toBe("e5");
    expect(recent[19]!.msg).toBe("e24");
  });

  it("appends to a daily file, writes a schema README, prunes files past retention", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cmcp-log-"));
    try {
      writeFileSync(path.join(dir, "calibre-mcp-2026-10-01.jsonl"), "{}\n"); // > 7 days old
      writeFileSync(path.join(dir, "calibre-mcp-2026-10-28.jsonl"), "{}\n");
      const { logger } = setup();
      logger.configure({ dir });
      logger.info("a");
      logger.error("b");
      const files = readdirSync(dir).sort();
      expect(files).toEqual(["README.md", "calibre-mcp-2026-10-28.jsonl", "calibre-mcp-2026-10-30.jsonl"]);
      const today = readFileSync(path.join(dir, "calibre-mcp-2026-10-30.jsonl"), "utf8").trim().split("\n");
      expect(today.map((l) => JSON.parse(l).msg)).toEqual(["a", "b"]);
      expect(logger.currentFile()).toBe(path.join(dir, "calibre-mcp-2026-10-30.jsonl"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a broken file sink never throws — it warns once and keeps stderr going", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cmcp-log-"));
    try {
      const { logger, lines } = setup();
      logger.configure({ dir });
      chmodSync(dir, 0o500); // read-only: append fails
      logger.info("one");
      logger.info("two");
      expect(lines.filter((l) => l.includes("log file sink disabled"))).toHaveLength(1);
      expect(lines.filter((l) => l.includes('"msg":"two"'))).toHaveLength(1);
      expect(logger.currentFile()).toBeNull();
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("boundValue", () => {
  it("caps long strings and arrays, flattens Errors", () => {
    const b = boundValue({ s: "x".repeat(600), a: Array.from({ length: 25 }, (_, i) => i), e: new Error("boom") }) as {
      s: string;
      a: unknown[];
      e: { name: string; message: string; stack: string };
    };
    expect(b.s).toMatch(/…\(\+100 chars\)$/);
    expect(b.a).toHaveLength(21);
    expect(b.a[20]).toBe("…(+5 items)");
    expect(b.e).toMatchObject({ name: "Error", message: "boom" });
    expect(b.e.stack).not.toContain("\n");
  });
});

describe("parseLevel", () => {
  it("accepts known levels case-insensitively, else info", () => {
    expect(parseLevel(" DEBUG ")).toBe("debug");
    expect(parseLevel("verbose")).toBe("info");
    expect(parseLevel(undefined)).toBe("info");
  });
});
