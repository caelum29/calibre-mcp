// calibre_ping header + per-library index breakdown (#304). Desktop shows the model only the
// text, so version / calibredb / write gate / per-library index facts must be in the text.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { VERSION } from "../../src/version.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import type { ToolDeps } from "../../src/tools/types.js";

const ping = allTools.find((t) => t.name === "calibre_ping")!;
const sdkVersion = (
  JSON.parse(readFileSync("node_modules/@modelcontextprotocol/server/package.json", "utf8")) as { version: string }
).version;

const MAP = { Programming_Books: "Programming Books", Humanities: "Humanities", Reaserch_Books: "Reaserch Books" };
const TOTALS: Record<string, number> = { Programming_Books: 1092, Humanities: 174, Reaserch_Books: 40 };
const BOOKS: Record<string, number> = { Programming_Books: 1064, Humanities: 147 };

interface Over {
  env?: Record<string, string>;
  libraryInfo?: () => Promise<unknown>;
  search?: (p: { library?: string }) => Promise<{ total: number }>;
  stats?: (id: string) => { books: number; chunks: number; figures: number };
  meta?: (id: string) => unknown;
}

function deps(o: Over = {}): ToolDeps {
  return {
    config: loadConfig({
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
      CALIBRE_MCP_CALIBREDB_PATH: "/opt/calibre/calibredb",
      ...o.env,
    }),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      libraryInfo: o.libraryInfo ?? (async () => ({ libraryMap: MAP, defaultLibrary: "Programming_Books" })),
      search: o.search ?? (async (p: { library?: string }) => ({ total: TOTALS[p.library ?? ""] ?? 0 })),
    } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "category,count\ntags,12" } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
    index: {
      hasIndex: (id: string) => id in BOOKS,
      indexMeta: (id: string) =>
        o.meta?.(id) ?? (id in BOOKS ? { modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION } : undefined),
      stats: o.stats ?? ((id: string) => ({ books: BOOKS[id] ?? 0, chunks: 10, figures: 0 })),
      vectorCount: () => 1,
      booksMissingVectors: () => 0,
    } as unknown as ToolDeps["index"],
    log,
  };
}

const text = (r: { content: Array<{ type: string; text?: string }> }): string =>
  r.content.map((b) => b.text ?? "").join("\n");

describe("calibre_ping header (#304)", () => {
  it("prints version, SDK version, calibredb path + Content Server URL and write gate (off)", async () => {
    const lines = text(await ping.handler({}, deps())).split("\n");
    expect(lines).toContain(`calibre-mcp ${VERSION} (MCP SDK ${sdkVersion})`);
    expect(lines).toContain("calibredb: /opt/calibre/calibredb (Content Server http://127.0.0.1:9)");
    expect(lines).toContain("writes: disabled (set CALIBRE_MCP_ENABLE_WRITE to enable)");
  });

  it("shows writes ENABLED when the gate is on", async () => {
    const lines = text(await ping.handler({}, deps({ env: { CALIBRE_MCP_ENABLE_WRITE: "1" } }))).split("\n");
    expect(lines).toContain("writes: ENABLED (CALIBRE_MCP_ENABLE_WRITE)");
  });

  it("drops the raw list_categories dump", async () => {
    expect(text(await ping.handler({}, deps()))).not.toContain("tags,12");
  });

  it("keeps the header when Calibre is unreachable", async () => {
    const d = deps();
    d.content.resolveLibraryId = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9");
    };
    const r = await ping.handler({}, d);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(`calibre-mcp ${VERSION} (MCP SDK ${sdkVersion})`);
    expect(text(r)).toContain("writes: disabled");
  });
});

describe("calibre_ping per-library index breakdown (#304)", () => {
  it("lists indexed/total per library and 'none' for an unindexed one", async () => {
    const lines = text(await ping.handler({}, deps())).split("\n");
    expect(lines).toContain(
      "Index: Programming Books: 1064/1092 indexed · Humanities: 147/174 indexed · Reaserch Books: none",
    );
  });

  it("degrades per library: unreachable total, unreadable store, stale index", async () => {
    const d = deps({
      search: async (p) => {
        if (p.library === "Programming_Books") throw new Error("boom");
        return { total: TOTALS[p.library ?? ""] ?? 0 };
      },
      stats: (id) => {
        if (id === "Humanities") throw new Error("database is locked");
        return { books: BOOKS[id] ?? 0, chunks: 1, figures: 0 };
      },
    });
    const r = await ping.handler({}, d);
    expect(r.isError).toBeUndefined();
    expect(text(r).split("\n")).toContain(
      "Index: Programming Books: 1064/? indexed · Humanities: index unreadable · Reaserch Books: none",
    );
  });

  it("marks a stale index", async () => {
    const d = deps({
      meta: (id) =>
        id === "Humanities" ? { modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION - 1 } : undefined,
    });
    expect(text(await ping.handler({}, d)).split("\n")).toContain(
      "Index: Programming Books: 1064/1092 indexed · Humanities: stale index (rebuild) · Reaserch Books: none",
    );
  });

  it("still pings ok when libraries cannot be listed", async () => {
    const r = await ping.handler({}, deps({ libraryInfo: async () => Promise.reject(new Error("down")) }));
    expect(r.isError).toBeUndefined();
    expect(text(r).split("\n")).toContain("Index: libraries unavailable");
  });
});
