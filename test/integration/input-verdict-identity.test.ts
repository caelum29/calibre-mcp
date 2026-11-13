// Pins the SDK behaviour the input contract (#590) rests on: the handler receives the very object
// the registered schema's validate returned. An SDK bump that clones it fails here, and at runtime
// the call is refused instead of running a handler on unvalidated args.

import { afterEach, describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";
import { allTools } from "../../src/tools/registry.js";
import { inputVerdict, refuseInvalidInput } from "../../src/tools/input-contract.js";
import { toolText } from "../../src/tools/result.js";

afterEach(() => vi.restoreAllMocks());

describe("input verdict identity", () => {
  it("should_hand_the_handler_the_validated_object_itself", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tool = allTools.find((t) => t.name === "calibre_semantic_search")!;
    const seen: unknown[] = [];
    vi.spyOn(tool, "handler").mockImplementation(async (args: unknown) => {
      seen.push(args);
      return toolText("ok", { semanticAvailable: true });
    });
    const server = buildServer({
      probes: false,
      env: { CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" },
    });
    const client = new Client({ name: "verdict-identity-test", version: "0" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    await client.connect(c);
    try {
      await client.callTool({ name: "calibre_semantic_search", arguments: { query: "ddd", topK: 5 } });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
    expect(inputVerdict(seen[0])).toEqual({});
  });

  it("should_refuse_args_with_no_recorded_verdict_as_internal", () => {
    const r = refuseInvalidInput("calibre_search", { query: "ddd" });
    expect({ isError: r?.isError, errorCode: r?.structuredContent?.errorCode }).toEqual({
      isError: true,
      errorCode: "internal",
    });
  });
});
