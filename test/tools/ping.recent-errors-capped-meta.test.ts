// #389 §Observability: two errors whose meta strings differ only past the 500-char log cap
// collapse into one recentErrors entry; calibre_ping must show that collapse in both channels.
// Own file: ping reads the process-wide logger, whose ring starts empty per test file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { AnyToolDescriptor } from "../../src/tools/types.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

const T0 = Date.parse("2026-11-05T00:00:00.000Z");
const at = (s: number): string => new Date(T0 + s * 1000).toISOString();

let index: SqliteIndexStore | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  index?.close();
  index = undefined;
});

function pingTool(): AnyToolDescriptor {
  const t = allTools.find((x) => x.name === "calibre_ping");
  if (!t) throw new Error("calibre_ping is not in the registry");
  return t;
}

function pingDeps(): ToolDeps {
  index = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
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

describe("calibre_ping shows a capped-meta collapse in both channels (#389)", () => {
  it("should_report_one_entry_with_2_occurrences_in_text_and_structuredContent", async () => {
    const long = (tail: string) => "x".repeat(500) + tail;
    log.error("extract failed", { detail: long("AAAA") });
    vi.advanceTimersByTime(1000);
    log.error("extract failed", { detail: long("BBBB") }); // same length: the cap hides the difference

    const r = await pingTool().handler({}, pingDeps());
    const sc = r.structuredContent as {
      recentErrors: Array<{ msg: string; ts: string; count: number; firstTs?: string; meta?: unknown }>;
    };
    expect(sc.recentErrors).toHaveLength(1);
    expect(sc.recentErrors[0]).toMatchObject({
      msg: "extract failed",
      count: 2,
      firstTs: at(0),
      ts: at(1),
      meta: { detail: `${"x".repeat(500)}…(+4 chars)` },
    });
    const text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    expect(text.split("\n")).toContain("recent errors: 1 (2 occurrences)");
    expect(text).toContain(`(×2 since ${at(0)})`);
  });
});
