#!/usr/bin/env node
// Transport entry point. Wires the McpServer to stdio and connects. Thin by
// design (DESIGN §7): all server logic lives in server.ts; this file only
// owns the transport so an HTTP transport could be added without touching it.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./server.js";
import { log } from "./logging.js";

// Claude Desktop 1.24012.x rejects a tools/call CLIENT-SIDE (pre-dispatch) for any tool
// whose outputSchema contains the `$schema` meta-key — which zod-to-json-schema (inside
// the SDK) always emits. Stripping the key is semantics-free (it's pure metadata), so we
// do it unconditionally on outgoing tools/list results until the client is fixed.
// Bisection + upstream report: docs/dev/bug-reports/2026-07-22-…-except-ping.md, #79933.
function stripDollarSchema(msg: JSONRPCMessage): JSONRPCMessage {
  if ("result" in msg && msg.result && Array.isArray((msg.result as { tools?: unknown }).tools)) {
    for (const tool of (msg.result as { tools: Array<Record<string, unknown>> }).tools) {
      const out = tool.outputSchema;
      if (out && typeof out === "object" && "$schema" in out) {
        delete (out as Record<string, unknown>).$schema;
      }
    }
  }
  return msg;
}

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
  const server = buildServer();
  const transport = new StdioServerTransport();
  const send = transport.send.bind(transport);
  transport.send = (msg) => send(stripDollarSchema(msg));
  await server.connect(transport);
  // Banner to stderr only — stdout carries the JSON-RPC stream.
  log.info("calibre-mcp listening on stdio");
}

main().catch((err) => {
  log.error("fatal", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});