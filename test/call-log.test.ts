// Per-tool-call record (#247): one closing `tool call` line per call, correlated by `call`.

import { describe, it, expect } from "vitest";
import { createLogger, type LogRecord } from "../src/logging.js";
import { parseTraceparent, redactArgvEchoes, summarizeArgs, summarizeArgv, withCallLog } from "../src/call-log.js";
import { ERROR_CODES, type ErrorCode } from "../src/domain/error-codes.js";

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

describe("summarizeArgv", () => {
  it("should_keep_flags_and_short_tokens_but_drop_long_free_text", () => {
    const query = "q".repeat(163);
    expect(summarizeArgv(["fts_search", "--output-format", "json", query])).toEqual([
      "fts_search",
      "--output-format",
      "json",
      "[text, 163 chars]",
    ]);
  });
});

describe("redactArgvEchoes", () => {
  it("should_replace_an_echoed_long_argv_value_with_its_marker", () => {
    const query = `LOGTEST-LONG ${"event sourcing ".repeat(10)}`;
    const diag = `Integration status: False\n\nFailed to parse search query: ${query}`;
    expect(redactArgvEchoes(diag, ["fts_search", "--output-format=json", query])).toBe(
      `Integration status: False\n\nFailed to parse search query: [text, ${query.length} chars]`,
    );
  });

  it("should_leave_short_argv_values_untouched", () => {
    expect(redactArgvEchoes("bad id 42", ["show_metadata", "42"])).toBe("bad id 42");
  });
});

describe("withCallLog — #249 hint + trace context", () => {
  it("should_copy_the_hint_into_the_tool_call_record", async () => {
    const { logger, records, now } = setup();
    await withCallLog(logger, { tool: "calibre_semantic_search", args: {}, now }, async () => ({
      isError: true,
      content: [{ type: "text", text: "Error: No semantic index" }],
      structuredContent: { errorCode: "index_missing", hint: "run calibre_build_index first" },
    }));
    expect(records()[0]?.meta).toMatchObject({ errorCode: "index_missing", hint: "run calibre_build_index first" });
  });

  it("should_log_traceId_and_parentSpanId_from_a_traceparent", async () => {
    const { logger, records, now } = setup();
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    await withCallLog(logger, { tool: "calibre_ping", args: {}, traceparent, now }, async () => ({ content: [] }));
    expect(records()[0]?.meta).toMatchObject({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentSpanId: "00f067aa0ba902b7",
    });
  });

  it("should_ignore_a_malformed_traceparent", async () => {
    const { logger, records, now } = setup();
    await withCallLog(logger, { tool: "calibre_ping", args: {}, traceparent: "garbage", now }, async () => ({
      content: [],
    }));
    expect(records()[0]?.meta).not.toHaveProperty("traceId");
  });
});

// #325: which isError results reach calibre_ping.recentErrors. A code that means the server or
// its environment is broken (the user must fix something outside the chat) logs at error and
// lands in the ring with its hint; a code the model fixes by changing its call stays at warn.
describe("withCallLog — #325 recentErrors rule", () => {
  const LEVEL_BY_CODE: Record<ErrorCode, "warn" | "error"> = {
    invalid_input: "warn",
    not_found: "warn",
    path_not_allowed: "warn",
    write_refused: "error",
    write_disabled: "warn",
    write_failed: "error",
    write_unverified: "error",
    calibre_unreachable: "error",
    calibre_busy: "warn",
    calibre_too_old: "warn",
    calibre_error: "error",
    timeout: "error",
    cancelled: "warn",
    fts_unavailable: "warn",
    index_missing: "warn",
    index_incompatible: "warn",
    index_build_failed: "error",
    library_id_collision: "error",
    dependency_missing: "error",
    extraction_failed: "error",
    internal: "error",
  };

  it("should_classify_every_error_code", () => {
    expect(Object.keys(LEVEL_BY_CODE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it.each(ERROR_CODES.map((code) => [code, LEVEL_BY_CODE[code]] as const))(
    "should_close_an_isError_%s_result_at_%s",
    async (code, lvl) => {
      const { logger, records, now } = setup();
      await withCallLog(logger, { tool: "calibre_get_book", args: {}, now }, async () => ({
        isError: true,
        content: [{ type: "text", text: `Error: ${code}` }],
        structuredContent: { errorCode: code },
      }));
      expect(records()[0]?.lvl).toBe(lvl);
    },
  );

  it("should_put_a_server_fault_result_in_recentErrors_with_its_code_and_hint", async () => {
    const { logger, now } = setup();
    await withCallLog(logger, { tool: "calibre_get_book", args: { id: 3 }, now }, async () => ({
      isError: true,
      content: [{ type: "text", text: "Error: Content Server unreachable" }],
      structuredContent: { errorCode: "calibre_unreachable", hint: "start the Content Server" },
    }));
    expect(logger.recentErrors().map((r) => ({ msg: r.msg, tool: r.tool, meta: r.meta }))).toMatchObject([
      {
        msg: "tool call",
        tool: "calibre_get_book",
        meta: { errorCode: "calibre_unreachable", hint: "start the Content Server" },
      },
    ]);
  });

  it("should_keep_a_caller_error_result_out_of_recentErrors", async () => {
    const { logger, now } = setup();
    await withCallLog(logger, { tool: "calibre_get_book", args: { id: 3 }, now }, async () => ({
      isError: true,
      content: [{ type: "text", text: "Error: book 3 not found" }],
      structuredContent: { errorCode: "not_found" },
    }));
    expect(logger.recentErrors()).toEqual([]);
  });

  it("should_keep_an_isError_result_without_a_code_at_warn", async () => {
    const { logger, records, now } = setup();
    await withCallLog(logger, { tool: "x", args: {}, now }, async () => ({
      isError: true,
      content: [{ type: "text", text: "Error: tool x disabled" }],
    }));
    expect(records()[0]?.lvl).toBe("warn");
  });
});

// #325: W3C Trace Context Level 1 (Recommendation 2021-11-23), https://www.w3.org/TR/trace-context/
describe("parseTraceparent — #325 W3C versioning", () => {
  const TID = "4bf92f3577b34da6a3ce929d0e0e4736";
  const PID = "00f067aa0ba902b7";
  const OK = { traceId: TID, parentSpanId: PID };

  it.each([
    // §3.2.4: a higher version is parsed by its known fields; anything after a dash is ignored
    ["a higher version with trailing fields", `01-${TID}-${PID}-01-future-field`, OK],
    ["a higher version with no trailing fields", `01-${TID}-${PID}-01`, OK],
    ["the highest legal version", `fe-${TID}-${PID}-00-x`, OK],
    ["version 00", `00-${TID}-${PID}-01`, OK],
    ["surrounding whitespace (header OWS)", `  00-${TID}-${PID}-01 `, OK],
  ])("should_parse_%s", (_name, tp, expected) => {
    expect(parseTraceparent(tp)).toEqual(expected);
  });

  it.each([
    // §3.2.2.1: version ff is forbidden
    ["version ff", `ff-${TID}-${PID}-01`],
    // §3.2.2.2: version 00 is exactly the three fields
    ["version 00 with trailing fields", `00-${TID}-${PID}-01-extra`],
    // §3.2.4: the flags must be followed by end of string or a dash
    ["a higher version whose flags run on", `01-${TID}-${PID}-01x`],
    // §3.2.4: shorter than 55 chars is not parsed
    ["a higher version shorter than 55 chars", `01-${TID}-${PID}-0`],
    // §3.2.2: every field is lowercase hex (HEXDIGLC)
    ["an uppercase trace-id", `00-${TID.toUpperCase()}-${PID}-01`],
    ["an uppercase parent-id", `00-${TID}-${PID.toUpperCase()}-01`],
    ["a non-hex version", `0g-${TID}-${PID}-01`],
    // §3.2.2.3 / §3.2.2.4: all-zero ids are invalid
    ["an all-zero trace-id", `01-${"0".repeat(32)}-${PID}-01`],
    ["an all-zero parent-id", `01-${TID}-${"0".repeat(16)}-01`],
  ])("should_reject_%s", (_name, tp) => {
    expect(parseTraceparent(tp)).toEqual({});
  });
});

// #627: the closing line records what a search returned and how big each result was.
describe("withCallLog result summary (#627)", () => {
  const search = (sc: Record<string, unknown>, text = "hello") => ({
    content: [{ type: "text", text }],
    structuredContent: sc,
  });
  const lib = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      bookId: 100 + i,
      title: `SECRET TITLE ${i}`,
      authors: ["A"],
      charStart: 1000 * (i + 1),
      charEnd: 1000 * (i + 1) + 500,
      snippetStart: 1000 * (i + 1) + 40,
      snippet: `SECRET SNIPPET ${i}`,
    }));

  async function metaOf(tool: string, result: object, args: unknown = {}) {
    const { logger, records, now } = setup();
    await withCallLog(logger, { tool, args, now }, async () => result);
    return records()[0]!.meta as Record<string, unknown>;
  }

  it("should_log_library_hits_in_order_with_lowConfidence_and_maxRerank", async () => {
    const meta = await metaOf(
      "calibre_semantic_search",
      search({ scope: "library", lowConfidence: true, maxRerank: 0.31, results: lib(3) }),
    );
    expect({ hits: meta.hits, lowConfidence: meta.lowConfidence, maxRerank: meta.maxRerank }).toEqual({
      hits: [
        { rank: 1, bookId: 100, charStart: 1000, snippetStart: 1040 },
        { rank: 2, bookId: 101, charStart: 2000, snippetStart: 2040 },
        { rank: 3, bookId: 102, charStart: 3000, snippetStart: 3040 },
      ],
      lowConfidence: true,
      maxRerank: 0.31,
    });
  });

  it("should_log_book_scope_hits_with_the_envelope_book_id", async () => {
    const meta = await metaOf(
      "calibre_semantic_search",
      search({
        scope: "book",
        bookId: 77,
        passages: [
          { charStart: 10, charEnd: 20, body: "SECRET BODY 1" },
          { charStart: 500, charEnd: 600, body: "SECRET BODY 2" },
        ],
      }),
    );
    expect(meta.hits).toEqual([
      { rank: 1, bookId: 77, charStart: 10 },
      { rank: 2, bookId: 77, charStart: 500 },
    ]);
  });

  it("should_log_figure_hits_as_book_figIndex_and_charOffset", async () => {
    const meta = await metaOf(
      "calibre_semantic_search",
      search({
        target: "figures",
        figures: [
          {
            bookId: 5,
            title: "T",
            authors: [],
            figIndex: 3,
            caption: "SECRET CAPTION",
            format: "PDF",
            charOffset: 900,
          },
        ],
      }),
    );
    expect(meta.hits).toEqual([{ rank: 1, bookId: 5, figIndex: 3, charOffset: 900 }]);
  });

  it("should_cap_hits_at_10_with_an_items_marker", async () => {
    const meta = await metaOf("calibre_semantic_search", search({ results: lib(12) }));
    const hits = meta.hits as unknown[];
    expect({ length: hits.length, last: hits[10], tenth: hits[9] }).toEqual({
      length: 11,
      last: "…(+2 items)",
      tenth: { rank: 10, bookId: 109, charStart: 10_000, snippetStart: 10_040 },
    });
  });

  it("should_not_put_snippet_body_caption_or_title_text_in_meta", async () => {
    const meta = await metaOf(
      "calibre_semantic_search",
      search({
        results: lib(2),
        passages: [{ charStart: 1, charEnd: 2, body: "SECRET BODY" }],
        figures: [{ bookId: 1, figIndex: 0, caption: "SECRET CAPTION", charOffset: 1, title: "SECRET TITLE" }],
      }),
    );
    expect(JSON.stringify(meta)).not.toContain("SECRET");
  });

  it("should_log_an_empty_hits_array_for_a_zero_hit_search", async () => {
    const meta = await metaOf("calibre_semantic_search", search({ scope: "library", count: 0 }));
    expect(meta.hits).toEqual([]);
  });

  it("should_log_no_hits_for_an_error_result_or_another_tool", async () => {
    const err = await metaOf("calibre_semantic_search", {
      isError: true,
      content: [{ type: "text", text: "boom" }],
      structuredContent: { errorCode: "not_found", results: lib(1) },
    });
    const other = await metaOf("calibre_search", search({ results: lib(1) }));
    expect({ err: "hits" in err, other: "hits" in other }).toEqual({ err: false, other: false });
  });

  it("should_measure_text_and_structured_chars_ignoring_resource_links", async () => {
    const sc = { a: 1, b: "xy" };
    const meta = await metaOf("calibre_get_book", {
      content: [
        { type: "text", text: "12345" },
        { type: "resource_link", uri: "calibre://book/1", name: "a much longer name than five" },
        { type: "text", text: "678" },
      ],
      structuredContent: sc,
    });
    expect({ textChars: meta.textChars, structuredChars: meta.structuredChars }).toEqual({
      textChars: 8,
      structuredChars: JSON.stringify(sc).length,
    });
  });

  it("should_omit_structuredChars_without_structuredContent_and_log_sizes_on_errors", async () => {
    const meta = await metaOf("calibre_get_book", { isError: true, content: [{ type: "text", text: "nope!" }] });
    expect({ textChars: meta.textChars, has: "structuredChars" in meta }).toEqual({ textChars: 5, has: false });
  });

  it("should_log_a_400_char_query_verbatim_but_still_redact_other_long_args", async () => {
    const q = "q".repeat(400);
    const meta = await metaOf("calibre_semantic_search", { content: [] }, { query: q, comments: "c".repeat(400) });
    expect(meta.args).toEqual({ query: q, comments: "[text, 400 chars]" });
  });
});

describe("withCallLog result safety (#627)", () => {
  it("should_return_the_original_result_and_omit_structuredChars_when_it_cannot_be_serialized", async () => {
    const { logger, records, now } = setup();
    const result = { content: [{ type: "text", text: "abc" }], structuredContent: { n: 10n } };
    const got = await withCallLog(logger, { tool: "calibre_get_book", args: {}, now }, async () => result);
    const meta = records()[0]!.meta as Record<string, unknown>;
    expect({ same: got === result, textChars: meta.textChars, has: "structuredChars" in meta }).toEqual({
      same: true,
      textChars: 3,
      has: false,
    });
  });
});
