// Builds the McpServer and registers tools. This is the ONLY layer that imports
// the MCP SDK (DESIGN §7) — tool logic, the calibre client, and domain code stay
// SDK-free so the SDK can be swapped behind this seam. Transport lives in run-stdio.ts.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { CalibreClient } from "./calibre/client.js";
import { log } from "./logging.js";

export function buildServer(): McpServer {
  const config = loadConfig();
  const calibre = new CalibreClient(config);

  const server = new McpServer({
    name: "calibre-mcp",
    version: "0.0.0",
  });

  // Connectivity probe — proves the server reaches the live Content Server.
  // Returns-not-throws on failure per the isError contract (DESIGN §3).
  server.registerTool(
    "calibre_ping",
    {
      title: "Calibre ping",
      description:
        "Health check: confirms the MCP server can reach the running Calibre " +
        "Content Server. Returns library categories on success.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const out = await calibre.listLibraries();
        const preview = out.slice(0, 500);
        return {
          content: [{ type: "text", text: `ok\n${preview}` }],
          structuredContent: { ok: true, serverUrl: config.serverUrl },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("ping failed", message);
        return {
          isError: true,
          content: [{ type: "text", text: `Calibre unreachable: ${message}` }],
          structuredContent: { ok: false, error: message },
        };
      }
    },
  );

  // Keep z referenced until real tools land (avoids unused-import churn).
  void z;

  log.info("server built", {
    writeEnabled: config.writeEnabled,
    serverUrl: config.serverUrl,
  });
  return server;
}