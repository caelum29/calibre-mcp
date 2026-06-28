#!/usr/bin/env node
// Transport entry point. Wires the McpServer to stdio and connects. Thin by
// design (DESIGN §7): all server logic lives in server.ts; this file only
// owns the transport so an HTTP transport could be added without touching it.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { log } from "./logging.js";

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Banner to stderr only — stdout carries the JSON-RPC stream.
  log.info("calibre-mcp listening on stdio");
}

main().catch((err) => {
  log.error("fatal", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});