// Per-tool-call record (#247): one closing `tool call` line per call, correlated by `call`.

import { describe, it, expect } from "vitest";
import { createLogger, type LogRecord } from "../src/logging.js";
import { summarizeArgs, withCallLog } from "../src/call-log.js";

function setup() {
  const lines: string[] = [];
  const logger = createLogger({ stderr: (s) => void lines.push(s) });
  const records = () => lines.map((l) => JSON.parse(l.replace(/^\[calibre-mcp\] /, "")) as LogRecord);
  let t = 0;
  const now = () => (t += 250);
  return { logger, records, now };
}

describe("withCallLog", () => {
  it("should_close_a_successful_call_with_an_info_record", async () => {
    const { logger, records, now } = setup();
    await withCallLog(
      logger,
      { tool: "calibre_search", args: { query: "ddd", limit: 5 }, rpcId: 7, now },
      async () => ({
        content: [],
      }),
    );
    expect(records()[0]).toMatchObject({
      lvl: "info",
      msg: "tool call",
      tool: "calibre_search",
      meta: { durationMs: 250, rpcId: 7, isError: false, args: { query: "ddd", limit: 5 } },
    });
  });

  it("should_log_isError_results_at_warn_with_code_and_steer_text", async () => {
    const { logger, records, now } = setup();
    await withCallLog(logger, { tool: "calibre_get_book", args: { id: 9 }, now }, async () => ({
      isError: true,
      content: [{ type: "text", text: "Error: book 9 not found — search first" }],
      structuredContent: { errorCode: "not_found" },
    }));
    expect(records()[0]).toMatchObject({
      lvl: "warn",
      meta: { isError: true, errorCode: "not_found", error: "Error: book 9 not found — search first" },
    });
  });

  it("should_tag_inner_lines_with_the_same_call_id_as_the_closing_record", async () => {
    const { logger, records, now } = setup();
    await withCallLog(logger, { tool: "calibre_build_index", args: {}, now }, async () => {
      logger.error("calibredb failed");
      return { content: [] };
    });
    const [inner, closing] = records();
    expect(inner!.call).toBe(closing!.call);
  });

  it("should_mark_a_thrown_call_and_rethrow", async () => {
    const { logger, records, now } = setup();
    const run = withCallLog(logger, { tool: "x", args: {}, now }, async () => {
      throw new Error("boom");
    });
    await expect(run).rejects.toThrow("boom");
    expect(records()[0]).toMatchObject({ lvl: "warn", meta: { threw: true } });
  });
});

describe("summarizeArgs", () => {
  it("should_drop_long_free_text_cap_arrays_and_reduce_objects_to_keys", () => {
    expect(
      summarizeArgs({
        comments: "x".repeat(200),
        ids: Array.from({ length: 12 }, (_, i) => i),
        fields: { title: "T", tags: ["a"] },
        apply: true,
        cursor: undefined,
      }),
    ).toEqual({
      comments: "[text, 200 chars]",
      ids: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "…(+2 items)"],
      fields: { keys: ["title", "tags"] },
      apply: true,
    });
  });

  it("should_return_undefined_for_empty_or_non_object_args", () => {
    expect([summarizeArgs({}), summarizeArgs(undefined), summarizeArgs([1])]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
