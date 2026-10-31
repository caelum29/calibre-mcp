// calibre_ping review fixes for #304: bounded time, read-only index access, structuredContent
// mirror of the new text facts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { VERSION } from "../../src/version.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const ping = allTools.find((t) => t.name === "calibre_ping")!;
const MAP = { Programming_Books: "Programming Books", Humanities: "Humanities", Reaserch_Books: "Reaserch Books" };
const META_OK = { modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION };

interface Spies {
  libraryInfo: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
}

function deps(o: {
  resolve?: () => Promise<string>;
  libraryInfo?: () => Promise<unknown>;
  search?: (p: unknown) => Promise<{ total: number }>;
  hasIndex?: (id: string) => boolean;
  meta?: (id: string) => unknown;
  writes?: boolean;
}): { d: ToolDeps; spies: Spies } {
  const libraryInfo = vi.fn(o.libraryInfo ?? (async () => ({ libraryMap: MAP, defaultLibrary: "Programming_Books" })));
  const search = vi.fn(o.search ?? (async () => ({ total: 100 })));
  const stats = vi.fn(() => ({ books: 10, chunks: 1, figures: 0 }));
  const d = {
    config: loadConfig({
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
      CALIBRE_MCP_CALIBREDB_PATH: "/opt/calibre/calibredb",
      ...(o.writes ? { CALIBRE_MCP_ENABLE_WRITE: "1" } : {}),
    }),
    content: {
      resolveLibraryId: o.resolve ?? (async () => "Programming_Books"),
      libraryInfo,
      search,
    } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "x" } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
    index: {
      hasIndex: o.hasIndex ?? ((id: string) => id === "Programming_Books"),
      indexMeta: o.meta ?? ((id: string) => (id === "Programming_Books" ? META_OK : undefined)),
      stats,
      vectorCount: () => 1,
      booksMissingVectors: () => 0,
    } as unknown as ToolDeps["index"],
    log,
  } as ToolDeps;
  return { d, spies: { libraryInfo, search, stats } };
}

const text = (r: { content: Array<{ type: string; text?: string }> }): string =>
  r.content.map((b) => b.text ?? "").join("\n");

afterEach(() => vi.useRealTimers());

describe("calibre_ping stays bounded (#304 review)", () => {
  it("skips the Index line without a second libraryInfo call when Calibre is unreachable", async () => {
    const { d, spies } = deps({
      resolve: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:9");
      },
    });
    const r = await ping.handler({}, d);
    expect(r.isError).toBe(true);
    expect(spies.libraryInfo).not.toHaveBeenCalled();
    expect(text(r).split("\n")).toContain("Index: skipped — Calibre unreachable");
  });

  it("gives up on a hanging libraryInfo after 5 s", async () => {
    vi.useFakeTimers();
    const { d } = deps({ libraryInfo: () => new Promise(() => {}) });
    const p = ping.handler({}, d);
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.isError).toBeUndefined();
    expect(text(r).split("\n")).toContain("Index: libraries unavailable");
  });

  it("shows ? for a total that does not answer within the deadline, keeping the indexed count", async () => {
    vi.useFakeTimers();
    const { d } = deps({ search: () => new Promise(() => {}) });
    const p = ping.handler({}, d);
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(text(r).split("\n")).toContain(
      "Index: Programming Books: 10/? indexed · Humanities: none · Reaserch Books: none",
    );
  });
});

describe("calibre_ping index access is read-only and breaker-free (#304 review)", () => {
  it("counts with noBreaker so a slow count cannot flag the library busy", async () => {
    const { d, spies } = deps({});
    await ping.handler({}, d);
    expect(spies.search).toHaveBeenCalledWith(
      expect.objectContaining({ library: "Programming_Books", num: 0, noBreaker: true }),
    );
  });

  it("does not open a store without a meta row (stats would initialise it under a write lock)", async () => {
    const { d, spies } = deps({ hasIndex: () => true, meta: () => undefined });
    const r = await ping.handler({}, d);
    expect(spies.stats).not.toHaveBeenCalled();
    expect(text(r).split("\n")).toContain(
      "Index: Programming Books: index unreadable · Humanities: index unreadable · Reaserch Books: index unreadable",
    );
  });
});

describe("calibre_ping structuredContent mirrors the new facts (#304 review)", () => {
  it("carries version, sdkVersion, calibredbPath, writeEnabled and the per-library index array", async () => {
    const { d } = deps({ writes: true });
    const sc = (await ping.handler({}, d)).structuredContent as Record<string, unknown>;
    expect(sc).toMatchObject({
      version: VERSION,
      calibredbPath: "/opt/calibre/calibredb",
      writeEnabled: true,
      indexes: [
        { id: "Programming_Books", name: "Programming Books", indexed: 10, total: 100, state: "ok" },
        { id: "Humanities", name: "Humanities", state: "none" },
        { id: "Reaserch_Books", name: "Reaserch Books", state: "none" },
      ],
    });
    expect(typeof sc.sdkVersion).toBe("string");
  });

  it("uses total: null when the count is unavailable and state stale/unreadable otherwise", async () => {
    const { d } = deps({
      search: async () => {
        throw new Error("down");
      },
      hasIndex: () => true,
      meta: (id) =>
        id === "Humanities"
          ? { ...META_OK, indexVersion: INDEX_VERSION - 1 }
          : id === "Reaserch_Books"
            ? undefined
            : META_OK,
    });
    const sc = (await ping.handler({}, d)).structuredContent as { indexes: unknown[] };
    expect(sc.indexes).toMatchObject([
      { id: "Programming_Books", indexed: 10, total: null, state: "ok" },
      { id: "Humanities", state: "stale" },
      { id: "Reaserch_Books", state: "unreadable" },
    ]);
  });

  it("keeps the facts on the unreachable path too", async () => {
    const { d } = deps({
      resolve: async () => {
        throw new Error("down");
      },
    });
    const sc = (await ping.handler({}, d)).structuredContent as Record<string, unknown>;
    expect(sc).toMatchObject({ version: VERSION, calibredbPath: "/opt/calibre/calibredb", writeEnabled: false });
  });
});
