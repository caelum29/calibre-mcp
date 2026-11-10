// Dev harness for stepping through a tool call in the IDE debugger: builds the real server
// in-process (same wiring as run-stdio.ts) and calls one tool over an in-memory transport.
// Run: node --import tsx scripts/debug-call.ts <tool> ['<json args>']   |   --list for tool names
// Or set DEBUG_TOOL / DEBUG_ARGS env (IDE run configs mangle JSON in program args, env values stay verbatim).
// Writes stay off unless CALIBRE_MCP_ENABLE_WRITE is set — a debug session shouldn't mutate the library by accident.

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../src/server.js";

const [argvTool, argvArgs] = process.argv.slice(2);
const toolName = argvTool ?? process.env.DEBUG_TOOL ?? "calibre_ping";
const rawArgs = argvArgs ?? process.env.DEBUG_ARGS ?? "{}";

const server = buildServer({
  env: {
    CALIBRE_MCP_SERVER_URL: "http://localhost:8080",
    ...process.env, // run-config env wins over the defaults above
  },
});
const client = new Client({ name: "debug-call", version: "0" });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
await client.connect(clientSide);

const print = (label: string, value: unknown): void => {
  process.stdout.write(`\n=== ${label} ===\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
};

try {
  if (toolName === "--list") {
    const { tools } = await client.listTools();
    print("tools", tools.map((t) => `${t.name}${t.annotations?.readOnlyHint ? "" : "  (write)"}`).join("\n"));
  } else {
    // args stay a raw object: the server's Zod coercion is part of what you're stepping through
    const args = JSON.parse(rawArgs) as Record<string, unknown>;
    const started = performance.now();
    const result = await client.callTool({ name: toolName, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    print(`${toolName} text (${Math.round(performance.now() - started)} ms, isError=${Boolean(result.isError)})`, text);
    if (result.structuredContent) print("structuredContent", result.structuredContent);
  }
} finally {
  await Promise.allSettled([client.close(), server.close()]);
}
