// "client initialized" log line (#124): it must carry the negotiated MCP revision, because
// Claude Desktop's own per-server log never prints it.

import { describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../src/server.js";
import { log } from "../src/logging.js";

const env = {
  CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
  CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
  CALIBRE_MCP_INDEX_DIR: ":memory:",
};

describe("client initialized log line (#124)", () => {
  it("records the negotiated protocol version", async () => {
    const info = vi.spyOn(log, "info");
    const server = buildServer({ env, probes: false });
    const client = new Client({ name: "init-log-test", version: "0" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    await client.connect(c);
    try {
      await client.listTools(); // a round trip, so `notifications/initialized` has landed
      const call = info.mock.calls.find(([msg]) => msg === "client initialized");
      expect(call?.[1]).toMatchObject({
        client: "init-log-test",
        protocolVersion: client.getNegotiatedProtocolVersion(),
      });
      expect(call?.[1]?.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      info.mockRestore();
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});
