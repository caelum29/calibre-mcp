// Pins tools/list order (spec 2026-07-28 SHOULD: deterministic, so clients and LLM prompt
// caches can reuse the list). Order = registry order, then calibre_ping; the write gate only
// removes tools, never reorders the rest.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/server.js";

// The documented order: src/tools/registry.ts allTools, then calibre_ping (registered last).
// Changing it is a deliberate act — update this list in the same commit.
const PINNED_ORDER = [
  "calibre_list_libraries",
  "calibre_search",
  "calibre_get_book",
  "calibre_get_content",
  "calibre_get_figures",
  "calibre_list_categories",
  "calibre_update_book",
  "calibre_semantic_search",
  "calibre_build_index",
  "calibre_find_duplicates",
  "calibre_quality_report",
  "calibre_recover_metadata",
  "calibre_extract_isbn",
  "calibre_bulk_update",
  "calibre_add_book",
  "calibre_remove_book",
  "calibre_merge_books",
  "calibre_manage_bundles",
  "calibre_board_data",
  "calibre_open_book",
  "calibre_ping",
];

async function listToolNames(writeEnabled: boolean, calls = 1): Promise<string[][]> {
  const server = buildServer({
    probes: false,
    env: {
      ...(writeEnabled ? { CALIBRE_MCP_ENABLE_WRITE: "1" } : {}),
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "order-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  try {
    const lists: string[][] = [];
    for (let i = 0; i < calls; i++) lists.push((await client.listTools()).tools.map((t) => t.name));
    return lists;
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

describe("tools/list order", () => {
  it("should_list_tools_in_the_pinned_order_with_writes_enabled", async () => {
    const [names] = await listToolNames(true);
    expect(names).toEqual(PINNED_ORDER);
  });

  it("should_return_an_identical_order_on_repeated_calls", async () => {
    const [first, second] = await listToolNames(true, 2);
    expect(second).toEqual(first);
  });

  it("should_keep_the_remaining_tools_in_pinned_order_when_the_write_gate_is_off", async () => {
    const [off] = await listToolNames(false);
    expect(off).toEqual(PINNED_ORDER.filter((n) => off!.includes(n)));
  });

  it("should_hide_write_tools_when_the_gate_is_off", async () => {
    const [off] = await listToolNames(false);
    expect(off!.length).toBeLessThan(PINNED_ORDER.length);
  });

  it("should_pin_exactly_the_tools_in_the_generated_catalog", () => {
    const catalog = JSON.parse(readFileSync("docs/tool-catalog.json", "utf8")) as { tools: Array<{ name: string }> };
    const catalogNames = catalog.tools.map((t) => t.name).sort();
    expect([...PINNED_ORDER].sort()).toEqual(catalogNames);
  });
});
