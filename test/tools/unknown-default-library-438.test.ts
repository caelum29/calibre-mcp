// #438 review: an unknown CALIBRE_MCP_LIBRARY (the configured default) is a config error, not an
// unreachable server — tools and calibre_ping name the env var and the known libraries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import { allTools } from "../../src/tools/registry.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

// getJson is the system boundary (fetch); the client above it runs for real.
vi.mock("../../src/calibre/http.js", () => ({ getJson: vi.fn(), getBytes: vi.fn() }));
import { getJson } from "../../src/calibre/http.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";

const mocked = vi.mocked(getJson);
const libInfo = {
  library_map: { Programming_Books: "Programming Books", Humanities: "Humanities" },
  default_library: "Programming_Books",
};

beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation(((url: string) => {
    if (url.includes("/ajax/library-info")) return Promise.resolve(libInfo);
    if (url.includes("/ajax/search/")) return Promise.resolve({ total_num: 0, offset: 0, num: 0, book_ids: [] });
    return Promise.reject(new Error("unexpected url " + url));
  }) as typeof getJson);
});

const env = { CALIBRE_MCP_LIBRARY: "Programing Books", CALIBRE_MCP_INDEX_DIR: ":memory:" };

function deps(): ToolDeps {
  const config = loadConfig(env);
  return {
    config,
    content: new ContentServerClient(config) as unknown as ToolDeps["content"],
    calibre: {
      listLibraries: async () => "category,count\ntags,12",
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } satisfies Partial<ToolDeps["embedder"]> as ToolDeps["embedder"],
    index: new SqliteIndexStore(config),
    log,
  };
}

const text = (r: ToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

const search = (over: Record<string, unknown>) =>
  searchTool.handler(z.object(searchTool.inputSchema).parse({ query: "rust", ...over }), deps(), {} as never);

describe("calibre_search with an unknown library", () => {
  it("should_name_CALIBRE_MCP_LIBRARY_when_the_unknown_name_is_the_configured_default", async () => {
    const r = await search({});
    expect(r.structuredContent?.errorCode).toBe("not_found");
    expect(text(r)).toContain('Unknown default library "Programing Books"');
    expect(text(r)).toContain("set by CALIBRE_MCP_LIBRARY");
    expect(text(r)).toContain('"Programming Books" (ID Programming_Books)');
  });

  it("should_keep_the_argument_message_when_the_unknown_name_is_the_library_argument", async () => {
    const r = await search({ library: "Nope" });
    expect(r.structuredContent?.errorCode).toBe("not_found");
    expect(text(r)).toContain('Unknown library "Nope"');
    expect(text(r)).not.toContain("CALIBRE_MCP_LIBRARY");
  });
});

describe("calibre_ping with an unknown configured default library", () => {
  const ping = async () => {
    const t = allTools.find((x) => x.name === "calibre_ping");
    if (!t) throw new Error("calibre_ping is not in the registry");
    return (await t.handler({}, deps(), {} as never)) as ToolResult;
  };

  it("should_not_report_calibre_as_unreachable", async () => {
    expect(text(await ping())).not.toContain("unreachable");
  });

  it("should_say_calibre_is_reachable_and_name_the_env_var_and_known_libraries", async () => {
    const t = text(await ping());
    expect(t).toContain("Calibre reachable");
    expect(t).toContain('Unknown default library "Programing Books"');
    expect(t).toContain("CALIBRE_MCP_LIBRARY");
    expect(t).toContain('"Humanities" (ID Humanities)');
  });

  it("should_still_run_the_index_section", async () => {
    expect(text(await ping())).toContain("Index: Programming Books: none");
  });
});
