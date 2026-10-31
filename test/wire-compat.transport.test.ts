// The wire-compat rewrite must sit on the REAL transport path (#270 review): the stdio
// send wrapper, and the shipped entry point (src/run-stdio.ts) end to end — so dropping
// the hookup fails here even though the catalog/compat tests apply the rewrite themselves.

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import { installWireCompat } from "../src/wire-compat.js";

interface WireTool {
  name: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

describe("installWireCompat on a StdioServerTransport", () => {
  it("should_write_draft_07_input_and_no_output_$schema_for_a_2020_12_tools_list", async () => {
    const stdout = new PassThrough();
    const written: string[] = [];
    stdout.on("data", (d: Buffer) => written.push(d.toString()));
    const transport = installWireCompat(new StdioServerTransport(new PassThrough(), stdout));

    await transport.send({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: [
          {
            name: "calibre_search",
            inputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" },
            outputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" },
          },
        ],
      },
    } as JSONRPCMessage);

    expect(JSON.parse(written.join(""))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: [
          {
            name: "calibre_search",
            inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" },
            outputSchema: { type: "object" },
          },
        ],
      },
    });
  });
});

describe("stdio entry point wire form", () => {
  // Spawns the shipped entry point; unreachable Content Server + :memory: index so nothing
  // touches a real library or log dir.
  it("should_send_tools_list_with_draft_07_inputs_and_no_output_$schema", async () => {
    const tsx = createRequire(import.meta.url).resolve("tsx");
    const entry = fileURLToPath(new URL("../src/run-stdio.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", tsx, entry], {
      env: { ...process.env, CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      const tools = await new Promise<WireTool[]>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no tools/list reply within 20 s")), 20_000);
        let buf = "";
        child.stdout.on("data", (d: Buffer) => {
          buf += d.toString();
          for (const line of buf.split("\n").slice(0, -1)) {
            const msg = JSON.parse(line) as { id?: number; result?: { tools?: WireTool[] } };
            if (msg.id === 2 && msg.result?.tools) {
              clearTimeout(t);
              resolve(msg.result.tools);
            }
          }
          buf = buf.slice(buf.lastIndexOf("\n") + 1);
        });
        const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
        send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "wire-test", version: "0" } },
        });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      });

      const withOutput = tools.filter((t) => t.outputSchema !== undefined);
      expect({
        inputDialects: [...new Set(tools.map((t) => t.inputSchema.$schema))],
        outputsWithDollarSchema: withOutput.filter((t) => "$schema" in (t.outputSchema ?? {})).map((t) => t.name),
        hasOutputSchemas: withOutput.length > 0,
      }).toEqual({
        inputDialects: ["http://json-schema.org/draft-07/schema#"],
        outputsWithDollarSchema: [],
        hasOutputSchemas: true,
      });
    } finally {
      child.stdin.end();
      child.kill("SIGTERM");
    }
  }, 30_000);
});
