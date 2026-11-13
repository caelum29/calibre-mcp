// #590/#591 over the real registration layer: schema violations come back as `Code: invalid_input`
// + `Next:` (never the SDK's bare "Input validation error"), an empty optional `filter` means unset,
// and a limit param that falls back to its default or max says so in the text and structuredContent.

import { afterEach, describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";
import { allTools } from "../../src/tools/registry.js";
import { toolText } from "../../src/tools/result.js";

async function connect() {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const server = buildServer({
    probes: false,
    env: {
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", // unroutable → every Calibre read fails
      CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "input-contract-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  return { client, close: () => Promise.allSettled([client.close(), server.close()]) };
}

async function call(name: string, args: Record<string, unknown>) {
  const { client, close } = await connect();
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await close();
  }
}

const textOf = (r: { content?: unknown }): string =>
  (r.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

/** Replace a tool's handler with one that records the parsed args and returns a minimal success. */
function spyHandler(name: string, structured: Record<string, unknown>): { seen: Array<Record<string, unknown>> } {
  const tool = allTools.find((t) => t.name === name)!;
  const seen: Array<Record<string, unknown>> = [];
  vi.spyOn(tool, "handler").mockImplementation(async (args: unknown) => {
    seen.push(args as Record<string, unknown>);
    return toolText("ok", structured);
  });
  return { seen };
}

const SEM_OK = { semanticAvailable: true };

afterEach(() => vi.restoreAllMocks());

describe("#590 schema violations follow the error contract", () => {
  it.each([
    ["calibre_semantic_search", { query: "" }],
    ["calibre_semantic_search", { query: "   " }],
    ["calibre_search", { query: "" }],
    ["calibre_semantic_search", { query: "x".repeat(513) }],
    ["calibre_search", { query: "x".repeat(513) }],
    ["calibre_semantic_search", { query: "ddd", mode: "bogus" }],
    ["calibre_search", { query: "ddd", mode: "bogus" }],
  ])("should_return_invalid_input_with_a_next_line_for_%s_%j", async (name, args) => {
    const r = await call(name, args);
    const text = textOf(r);
    expect({
      isError: r.isError,
      code: text.includes("Code: invalid_input"),
      next: /\nNext: \S/.test(text),
      sdk: text.includes("Input validation error"),
      errorCode: (r.structuredContent as Record<string, unknown> | undefined)?.errorCode,
    }).toEqual({ isError: true, code: true, next: true, sdk: false, errorCode: "invalid_input" });
  });

  it("should_name_the_offending_argument_in_the_message", async () => {
    const text = textOf(await call("calibre_semantic_search", { query: "ddd", mode: "bogus" }));
    expect(text).toContain("mode");
  });

  it("should_still_coerce_stringified_numbers_instead_of_rejecting_them", async () => {
    const { seen } = spyHandler("calibre_semantic_search", SEM_OK);
    const r = await call("calibre_semantic_search", { query: "ddd", topK: "7" });
    expect({ isError: r.isError ?? false, topK: seen[0]?.topK }).toEqual({ isError: false, topK: 7 });
  });

  it("should_advertise_query_as_a_plain_string", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const sem = tools.find((t) => t.name === "calibre_semantic_search")!;
      const props = sem.inputSchema.properties as Record<string, Record<string, unknown>>;
      expect({ type: props.query?.type, required: sem.inputSchema.required?.includes("query") }).toEqual({
        type: "string",
        required: true,
      });
    } finally {
      await close();
    }
  });
});

describe("#590 an empty optional filter means unset", () => {
  it.each([
    "calibre_semantic_search",
    "calibre_search",
    "calibre_find_duplicates",
    "calibre_quality_report",
    "calibre_bulk_update",
    "calibre_board_data",
  ])("should_pass_filter_undefined_to_the_%s_handler_for_blank_strings", async (name) => {
    const { seen } = spyHandler(name, {});
    const base: Record<string, unknown> =
      name === "calibre_semantic_search" || name === "calibre_search" ? { query: "ddd" } : {};
    if (name === "calibre_bulk_update") Object.assign(base, { tags_add: ["x"] });
    for (const filter of ["", "   "]) await call(name, { ...base, filter });
    expect(seen.map((a) => a.filter)).toEqual([undefined, undefined]);
  });
});

describe("#591 a limit param that falls back says so", () => {
  it.each([
    [{ topK: -5 }, 10, "topK -5 is below 1; used the default 10."],
    [{ topK: 0 }, 10, "topK 0 is below 1; used the default 10."],
    [{ topK: 500 }, 50, "topK 500 is above the max 50; used 50."],
    [{ topK: "abc" }, 10, 'topK "abc" is not a number; used the default 10.'],
  ])("should_note_semantic_search_%j", async (over, used, note) => {
    const { seen } = spyHandler("calibre_semantic_search", SEM_OK);
    const r = await call("calibre_semantic_search", { query: "ddd", ...over });
    expect({
      topK: seen[0]?.topK,
      inText: textOf(r).includes(note),
      paramNotes: (r.structuredContent as Record<string, unknown>).paramNotes,
    }).toEqual({ topK: used, inText: true, paramNotes: [note] });
  });

  it("should_note_get_content_maxChars_0", async () => {
    const { seen } = spyHandler("calibre_get_content", {});
    const r = await call("calibre_get_content", { id: 1, maxChars: 0 });
    const note = "maxChars 0 is below 1; used the default 8000.";
    expect({
      maxChars: seen[0]?.maxChars,
      inText: textOf(r).includes(note),
      paramNotes: (r.structuredContent as Record<string, unknown>).paramNotes,
    }).toEqual({ maxChars: 8000, inText: true, paramNotes: [note] });
  });

  it.each([[{}], [{ topK: 5 }], [{ topK: "5" }], [{ topK: "" }], [{ topK: null }]])(
    "should_add_no_note_for_an_in_range_or_absent_value_%j",
    async (over) => {
      spyHandler("calibre_semantic_search", SEM_OK);
      const r = await call("calibre_semantic_search", { query: "ddd", ...over });
      expect({
        text: textOf(r),
        paramNotes: (r.structuredContent as Record<string, unknown>).paramNotes,
      }).toEqual({ text: "ok", paramNotes: undefined });
    },
  );

  it("should_declare_paramNotes_in_the_outputSchema_of_exactly_the_limit_param_tools", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const declaring = tools
        .filter((t) => (t.outputSchema?.properties as Record<string, unknown> | undefined)?.paramNotes !== undefined)
        .map((t) => t.name)
        .sort();
      expect(declaring).toEqual([
        "calibre_find_duplicates",
        "calibre_get_content",
        "calibre_list_categories",
        "calibre_quality_report",
        "calibre_search",
        "calibre_semantic_search",
      ]);
    } finally {
      await close();
    }
  });
});
