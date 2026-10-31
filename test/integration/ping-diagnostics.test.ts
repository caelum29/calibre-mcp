// calibre_ping self-diagnosis (#247): recent server errors + log-file location in BOTH
// channels (Desktop reads text only, Code reads structuredContent only).

import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";

describe("calibre_ping diagnostics", () => {
  it("should_report_the_failed_ping_itself_in_recentErrors_text_and_structured", async () => {
    const server = buildServer({
      probes: false,
      env: {
        CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", // unroutable → ping fails and logs an error
        CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
        CALIBRE_MCP_INDEX_DIR: ":memory:",
      },
    });
    const client = new Client({ name: "ping-test", version: "0" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    await client.connect(c);
    try {
      const r = await client.callTool({ name: "calibre_ping", arguments: {} });
      const text = (r.content as Array<{ text: string }>).map((b) => b.text).join("\n");
      const sc = r.structuredContent as { logFile: string | null; recentErrors: Array<{ msg: string; tool?: string }> };
      expect({
        text: /log file: off[\s\S]*\[calibre_ping call=\w+\] ping failed/.test(text),
        logFile: sc.logFile,
        last: sc.recentErrors.at(-1),
      }).toMatchObject({ text: true, logFile: null, last: { msg: "ping failed", tool: "calibre_ping" } });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});
