// #249 end-to-end over the real server: the ping failure in recentErrors carries code + hint,
// and a client's W3C traceparent (params._meta) lands on the `tool call` record.

import { afterEach, describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";

async function connect() {
  const server = buildServer({
    probes: false,
    env: {
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", // unroutable → ping fails and logs an error
      CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "error-codes-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  return { client, close: () => Promise.allSettled([client.close(), server.close()]) };
}

afterEach(() => vi.restoreAllMocks());

describe("#249 over the wire", () => {
  it("should_report_the_ping_failure_with_errorCode_and_hint_in_recentErrors", async () => {
    const { client, close } = await connect();
    try {
      const r = await client.callTool({ name: "calibre_ping", arguments: {} });
      const sc = r.structuredContent as { recentErrors: Array<{ msg: string; meta?: Record<string, unknown> }> };
      const last = sc.recentErrors.at(-1);
      expect({ msg: last?.msg, code: last?.meta?.errorCode, hint: typeof last?.meta?.hint }).toEqual({
        msg: "ping failed",
        code: "calibre_unreachable",
        hint: "string",
      });
    } finally {
      await close();
    }
  });

  it("should_log_the_traceId_from_params_meta_traceparent", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
      lines.push(String(s));
      return true;
    });
    const { client, close } = await connect();
    try {
      await client.callTool({
        name: "calibre_board_data",
        arguments: { tool: "calibre_search" },
        _meta: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
      });
      const record = lines
        .map((l) => /\[calibre-mcp\] (\{.*\})/.exec(l)?.[1])
        .filter((j): j is string => j !== undefined)
        .map((j) => JSON.parse(j) as { msg: string; tool?: string; meta?: Record<string, unknown> })
        .find((rec) => rec.msg === "tool call" && rec.tool === "calibre_board_data");
      expect(record?.meta).toMatchObject({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", errorCode: "not_found" });
    } finally {
      await close();
    }
  });
});
