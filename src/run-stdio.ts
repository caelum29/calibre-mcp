#!/usr/bin/env node
// Transport entry point. Wires the McpServer to stdio and connects. Thin by
// design (DESIGN §7): all server logic lives in server.ts; this file only
// owns the transport so an HTTP transport could be added without touching it.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";
import { log } from "./logging.js";
import { createShutdown, installShutdownHandlers } from "./shutdown.js";
import { stripDollarSchema } from "./wire-compat.js";
import { VERSION } from "./version.js";

// Process-level safety net (issue #73). On Node >=15 a single unhandled rejection kills
// the process — the client then sees only a generic "Tool execution failed" with zero
// detail. A stray rejection is a missed handler, not corrupt state: log it loudly and
// keep serving. A sync uncaught exception may leave arbitrary state behind, so log the
// stack (stderr is captured in the client's MCP logs) and exit — named, not silent.
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.error("unhandled rejection (surviving; report at github.com/caelum29/calibre-mcp)", {
    name: err.name,
    msg: err.message,
    stack: err.stack,
  });
});
process.on("uncaughtException", (err) => {
  log.error("uncaught exception — exiting", {
    name: err.name,
    msg: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

async function main(): Promise<void> {
  // File sink is configured here, not in buildServer, so in-process test servers never write logs.
  const { logLevel, logDir } = loadConfig();
  log.configure({ level: logLevel, dir: logDir });
  const server = buildServer();
  const transport = new StdioServerTransport();
  const send = transport.send.bind(transport);
  // Client-compat rewrite of outgoing tools/list results (wire-compat.ts) — the same one the
  // tool-catalog generator applies, so docs/tool-catalog.json matches the wire.
  transport.send = (msg) => send(stripDollarSchema(msg));
  await server.connect(transport);
  // Exit with the client: stdin EOF/close or SIGINT/SIGTERM kills any running calibredb /
  // ebook-convert process groups, closes the server and exits 0 (idempotent).
  installShutdownHandlers(createShutdown({ close: () => server.close(), exit: (code) => process.exit(code) }));
  // Banner to stderr only — stdout carries the JSON-RPC stream.
  log.info("calibre-mcp listening on stdio", { version: VERSION, node: process.version, logFile: log.currentFile() });
}

main().catch((err) => {
  log.error("fatal", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
