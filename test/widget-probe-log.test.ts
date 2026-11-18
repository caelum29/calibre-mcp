// widget-probe log line (#680): object meta, so `jq .meta.line` works on every line.

import { describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../src/server.js";
import { log } from "../src/logging.js";

describe("widget probe log (#680)", () => {
  it("should_write_the_widget_probe_line_as_object_meta", async () => {
    const info = vi.spyOn(log, "info");
    const server = buildServer({
      env: {
        CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
        CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
        CALIBRE_MCP_INDEX_DIR: ":memory:",
        CALIBRE_MCP_WIDGET_DEBUG: "1",
      },
      probes: false,
    });
    const client = new Client({ name: "probe-test", version: "0" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    await client.connect(c);
    try {
      await client.callTool({ name: "calibre_widget_log", arguments: { line: "ctx origin=x" } });
      const call = info.mock.calls.find(([msg]) => msg === "widget-probe");
      expect(call?.[1]).toEqual({ line: "ctx origin=x" });
    } finally {
      info.mockRestore();
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});
