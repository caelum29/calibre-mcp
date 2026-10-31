// #325 end-to-end over the real server (registration, safety net, write gate, call log): an error
// result read from structuredContent alone — all the Claude Code tab shows the model — still
// carries error + errorCode (+ hint), and server faults surface in calibre_ping.recentErrors.

import { afterEach, describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";
import { allTools } from "../../src/tools/registry.js";
import { defaultHint } from "../../src/domain/error-codes.js";

async function connect() {
  const server = buildServer({
    probes: false,
    env: {
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", // unroutable → every Calibre read fails
      CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "error-channels-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  return { client, close: () => Promise.allSettled([client.close(), server.close()]) };
}

function captureStderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
    lines.push(String(s));
    return true;
  });
  return lines;
}

interface Rec {
  msg: string;
  tool?: string;
  meta?: Record<string, unknown>;
}

function records(lines: string[]): Rec[] {
  return lines
    .map((l) => /\[calibre-mcp\] (\{.*\})/.exec(l)?.[1])
    .filter((j): j is string => j !== undefined)
    .map((j) => JSON.parse(j) as Rec);
}

afterEach(() => vi.restoreAllMocks());

describe("#325 error results, structuredContent only", () => {
  it("should_carry_error_errorCode_and_hint_for_a_handler_returned_error", async () => {
    captureStderr();
    const { client, close } = await connect();
    try {
      const r = await client.callTool({ name: "calibre_get_book", arguments: { id: 1 } });
      const sc = r.structuredContent as Record<string, unknown>;
      expect({ isError: r.isError, error: typeof sc.error, errorCode: sc.errorCode, hint: sc.hint }).toEqual({
        isError: true,
        error: "string",
        errorCode: "calibre_unreachable",
        hint: defaultHint("calibre_unreachable"),
      });
    } finally {
      await close();
    }
  });

  it("should_carry_error_and_errorCode_when_the_safety_net_catches_a_throw", async () => {
    captureStderr();
    const getBook = allTools.find((t) => t.name === "calibre_get_book")!;
    vi.spyOn(getBook, "handler").mockRejectedValue(new TypeError("boom"));
    const { client, close } = await connect();
    try {
      const r = await client.callTool({ name: "calibre_get_book", arguments: { id: 1 } });
      expect({ isError: r.isError, sc: r.structuredContent }).toEqual({
        isError: true,
        sc: { error: "internal error in calibre_get_book — TypeError: boom", errorCode: "internal" },
      });
    } finally {
      await close();
    }
  });

  it("should_list_a_returned_server_fault_in_ping_recentErrors_with_its_hint", async () => {
    captureStderr();
    const { client, close } = await connect();
    try {
      await client.callTool({ name: "calibre_get_book", arguments: { id: 1 } });
      const ping = await client.callTool({ name: "calibre_ping", arguments: {} });
      const sc = ping.structuredContent as { recentErrors: Rec[] };
      const fault = sc.recentErrors.filter((e) => e.msg === "tool call" && e.tool === "calibre_get_book").at(-1);
      expect(fault?.meta).toMatchObject({
        isError: true,
        errorCode: "calibre_unreachable",
        hint: defaultHint("calibre_unreachable"),
      });
    } finally {
      await close();
    }
  });
});

describe("#325 write gate", () => {
  // A gated write tool never reaches our handler: the SDK refuses it as a JSON-RPC protocol
  // error, so there is no tool result (and no structuredContent) to carry an errorCode.
  it("should_refuse_a_gated_write_tool_as_a_protocol_error_not_a_result", async () => {
    captureStderr();
    const { client, close } = await connect();
    try {
      const call = client.callTool({ name: "calibre_update_book", arguments: { id: 1 } });
      await expect(call).rejects.toMatchObject({ code: -32602, message: "Tool calibre_update_book disabled" });
    } finally {
      await close();
    }
  });
});

describe("#325 trace context over the wire", () => {
  it("should_log_traceparent_ids_but_never_tracestate_or_baggage", async () => {
    const lines = captureStderr();
    const { client, close } = await connect();
    try {
      await client.callTool({
        name: "calibre_board_data",
        arguments: { tool: "calibre_search" },
        _meta: {
          traceparent: "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-future",
          tracestate: "vendorx=secret-state-value",
          baggage: "user.email=someone%40example.com",
        },
      });
      const record = records(lines).find((rec) => rec.msg === "tool call" && rec.tool === "calibre_board_data");
      const all = lines.join("");
      expect({
        meta: record?.meta,
        tracestate: all.includes("secret-state-value"),
        baggage: all.includes("someone"),
      }).toMatchObject({
        meta: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "00f067aa0ba902b7" },
        tracestate: false,
        baggage: false,
      });
    } finally {
      await close();
    }
  });
});
