// Server `instructions` (#262): a real initialize over an in-memory client must carry the
// cross-tool guidance, within the length cap, naming only tools/env vars that exist.

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { MAX_INSTRUCTIONS_LENGTH, SERVER_INSTRUCTIONS } from "../src/instructions.js";
import { allTools } from "../src/tools/registry.js";

const env = {
  CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
  CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
  CALIBRE_MCP_INDEX_DIR: ":memory:",
};

async function initializeInstructions(): Promise<string | undefined> {
  const server = buildServer({ env, probes: false });
  const client = new Client({ name: "instructions-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  try {
    return client.getInstructions();
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

describe("server instructions (#262)", () => {
  it("are sent at initialize and equal the shared constant", async () => {
    expect(await initializeInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it("stay within the length cap", async () => {
    const text = (await initializeInstructions()) ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(MAX_INSTRUCTIONS_LENGTH);
    expect(MAX_INSTRUCTIONS_LENGTH).toBe(1000);
  });

  it("lead with library discovery and state the key rules", async () => {
    const text = (await initializeInstructions()) ?? "";
    expect(text.indexOf("calibre_list_libraries")).toBeLessThan(200);
    for (const rule of [
      "calibre_search",
      "calibre_semantic_search",
      "scope=book",
      "preview",
      "confirm",
      "CALIBRE_MCP_ENABLE_WRITE",
    ]) {
      expect(text).toContain(rule);
    }
  });

  it("mention only tools that exist", async () => {
    const text = (await initializeInstructions()) ?? "";
    const names = new Set(allTools.map((t) => t.name));
    const mentioned = text.match(/\bcalibre_[a-z_]+/g) ?? [];
    expect(mentioned.length).toBeGreaterThanOrEqual(4);
    for (const m of mentioned) expect(names.has(m), m).toBe(true);
  });
});
