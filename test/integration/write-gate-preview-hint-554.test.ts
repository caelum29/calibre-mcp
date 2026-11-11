// #554 end to end: the real buildServer with a fake Content Server. A gate-off preview of a write
// tool carries `writeEnabled: false` and the remedy once in its text; gate on, it carries neither;
// the gate-off apply call is still the plain write_disabled refusal.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";

const LIB = "Test_Lib";
let http: Server;
let baseUrl: string;

beforeAll(async () => {
  http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (body: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/ajax/library-info")
      return json({ library_map: { [LIB]: "Test Lib" }, default_library: LIB });
    if (url.pathname === `/ajax/books/${LIB}`) {
      return json({ "1": { application_id: 1, title: "Rust in Action", authors: ["Tim McNamara"], formats: [] } });
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

async function withClient<T>(writeEnabled: boolean, fn: (client: Client) => Promise<T>): Promise<T> {
  const server = buildServer({
    probes: false,
    env: {
      ...(writeEnabled ? { CALIBRE_MCP_ENABLE_WRITE: "1" } : {}),
      CALIBRE_MCP_SERVER_URL: baseUrl,
      CALIBRE_MCP_CALIBREDB_PATH: "/nonexistent/calibredb-554",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "write-gate-554", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  try {
    return await fn(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

async function removeBook(writeEnabled: boolean, args: Record<string, unknown>) {
  return withClient(writeEnabled, async (client) => {
    const r = await client.callTool({ name: "calibre_remove_book", arguments: args });
    const text = (r.content as Array<{ type: string; text?: string }>).map((b) => b.text ?? "").join("\n");
    return { isError: r.isError === true, text, sc: r.structuredContent as Record<string, unknown> | undefined };
  });
}

describe("gate-off preview hint through buildServer (#554)", () => {
  it("should_mark_a_gate_off_dry_run_writeEnabled_false_with_one_remedy_line", async () => {
    const r = await removeBook(false, { ids: [1] });
    expect(r.isError).toBe(false);
    expect(r.sc?.writeEnabled).toBe(false);
    expect(r.sc?.wouldRemove).toEqual([{ id: 1, title: "Rust in Action" }]);
    expect(r.text.match(/needs writes enabled \(CALIBRE_MCP_ENABLE_WRITE\)/g)).toHaveLength(1);
  });

  it("should_leave_a_gate_on_dry_run_without_the_hint", async () => {
    const r = await removeBook(true, { ids: [1] });
    expect(r.isError).toBe(false);
    expect(r.sc && "writeEnabled" in r.sc).toBe(false);
    expect(r.text).not.toContain("needs writes enabled");
    expect(r.text).toContain("Re-run with confirm=true to proceed.");
  });

  it("should_refuse_the_gate_off_apply_call_with_plain_write_disabled", async () => {
    const r = await removeBook(false, { ids: [1], confirm: true });
    expect(r.isError).toBe(true);
    expect(r.sc?.errorCode).toBe("write_disabled");
    expect(r.sc && "writeEnabled" in r.sc).toBe(false);
  });

  it("should_announce_writeEnabled_in_the_outputSchema_of_a_preview_first_write_tool", async () => {
    const tools = await withClient(false, async (client) => (await client.listTools()).tools);
    const props = tools.find((t) => t.name === "calibre_remove_book")?.outputSchema?.properties ?? {};
    expect(Object.keys(props)).toContain("writeEnabled");
  });
});
