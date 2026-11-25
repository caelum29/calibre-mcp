// #598 (ADR-0035): calibre_search is meta|fts only. The old annotations/notes modes get an
// invalid_input steer naming calibre_search_annotations and the kind to pass — in BOTH channels
// (Desktop reads the text, Claude Code reads structuredContent). No alias. calibre_build_index
// loses enableFts in the same change.

import { afterEach, describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";

async function connect() {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const server = buildServer({
    probes: false,
    env: {
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "old-modes-steer-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  return { client, close: () => Promise.allSettled([client.close(), server.close()]) };
}

const textOf = (r: { content?: unknown }): string =>
  (r.content as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

afterEach(() => vi.restoreAllMocks());

describe("calibre_search old modes (#598)", () => {
  it.each(["annotations", "notes"])(
    "should_steer_mode_%s_to_calibre_search_annotations_in_both_channels",
    async (mode) => {
      const { client, close } = await connect();
      try {
        const r = await client.callTool({ name: "calibre_search", arguments: { query: "commit", mode } });
        const text = textOf(r);
        const sc = r.structuredContent as { errorCode?: string; error?: string; hint?: string };
        expect(r.isError).toBe(true);
        expect(text).toContain("Code: invalid_input");
        expect(text).toContain("calibre_search_annotations");
        expect(text).toContain(`kind: "${mode}"`);
        expect(sc.errorCode).toBe("invalid_input");
        expect(`${sc.error} ${sc.hint ?? ""}`).toContain("calibre_search_annotations");
        expect(`${sc.error} ${sc.hint ?? ""}`).toContain(`kind: "${mode}"`);
      } finally {
        await close();
      }
    },
  );

  it("should_advertise_only_meta_and_fts_as_search_modes", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const schema = tools.find((t) => t.name === "calibre_search")!.inputSchema as unknown as {
        properties: { mode: { enum: string[] } };
      };
      expect(schema.properties.mode.enum).toEqual(["meta", "fts"]);
    } finally {
      await close();
    }
  });
});

describe("calibre_build_index enableFts (#598)", () => {
  it("should_not_advertise_enableFts", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const props = (tools.find((t) => t.name === "calibre_build_index")!.inputSchema as { properties: object })
        .properties;
      expect(Object.keys(props)).not.toContain("enableFts");
    } finally {
      await close();
    }
  });
});
