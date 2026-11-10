// #437 follow-up (whole-wave review): calibre_search errors and calibre_ping's busy report state
// their next step once — no generic `Next:` line repeating or contradicting the site's own step —
// and ping's busy report says busy, not unreachable. Fakes only.

import { describe, expect, it } from "vitest";
import { searchTool, type SearchDeps, type SearchIndex } from "../../src/tools/calibre_search.js";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { CalibreBusyError, CalibreHttpTimeoutError, CalibreNotFoundError, FtsError } from "../../src/domain/errors.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { fakeFts } from "./fake-fts.js";
import { textOf } from "./text-of.js";

const LIB = asLibId("My_Books");
const ftsArgs = { query: "event sourcing", mode: "fts", scope: "library", limit: 20 } as const;

function ftsFails(err: Error): SearchDeps {
  return {
    config: loadConfig({}),
    content: { resolveLibraryId: async () => "My_Books" } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false, isBookIndexed: () => false } satisfies SearchIndex,
    log,
    fts: fakeFts([], { match: async () => Promise.reject(err) }),
  };
}

const count = (text: string, s: string): number => text.split(s).length - 1;

describe("calibre_search errors state one next step (#437 follow-up)", () => {
  it("FTS_DISABLED: enable once, the keyword fallback once, no generic Next", async () => {
    const t = textOf(await searchTool.handler(ftsArgs, ftsFails(new FtsError("FTS_DISABLED", LIB))));
    expect({
      code: t.split("\n").at(-1),
      next: count(t, "\nNext: "),
      enable: count(t, "Enable it in Calibre"),
      keyword: count(t, 'calibre_semantic_search with mode:"keyword"'),
      meta: t.includes("mode=meta"),
    }).toEqual({ code: "Code: fts_unavailable", next: 0, enable: 1, keyword: 1, meta: false });
  });

  it("busy: the breaker's own retry, no generic retry Next", async () => {
    const t = textOf(await searchTool.handler(ftsArgs, ftsFails(new CalibreBusyError("My_Books", 42_000))));
    expect({ code: t.split("\n").at(-1), next: count(t, "\nNext: "), retry: count(t, "Retry in ~42 s") }).toEqual({
      code: "Code: calibre_busy",
      next: 0,
      retry: 1,
    });
  });

  it("timeout: its own retry-or-narrow, no generic Next", async () => {
    const t = textOf(
      await searchTool.handler(ftsArgs, ftsFails(new CalibreHttpTimeoutError("http://127.0.0.1:9/fts/search"))),
    );
    expect({ code: t.split("\n").at(-1), next: count(t, "\nNext: ") }).toEqual({ code: "Code: timeout", next: 0 });
  });

  it("missing calibredb: its own install step, no generic install Next", async () => {
    const err = new CalibreNotFoundError("calibredb not found — install Calibre or set CALIBRE_MCP_CALIBREDB_PATH");
    const t = textOf(await searchTool.handler(ftsArgs, ftsFails(err)));
    expect({ code: t.split("\n").at(-1), next: count(t, "\nNext: ") }).toEqual({
      code: "Code: dependency_missing",
      next: 0,
    });
  });
});

describe("calibre_ping busy report (#437 follow-up)", () => {
  it("says busy in the headline and the Index reason, with one next step", async () => {
    const ping = allTools.find((t) => t.name === "calibre_ping")!;
    const busy = new CalibreBusyError("My_Books", 42_000);
    const d: ToolDeps = {
      config: loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" }),
      content: { resolveLibraryId: async () => "My_Books" } as unknown as ToolDeps["content"],
      calibre: {
        listLibraries: async () => {
          throw busy;
        },
      } as unknown as ToolDeps["calibre"],
      extractor: {} as ToolDeps["extractor"],
      figures: {} as ToolDeps["figures"],
      embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
      index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
      log,
    };
    const r = await ping.handler({}, d);
    const lines = textOf(r).split("\n");
    expect({
      headline: lines[0],
      index: lines.find((l) => l.startsWith("Index: ")),
      unreachable: lines.some((l) => l.includes("unreachable")),
      code: lines.filter((l) => l.startsWith("Code: ")),
      next: lines.filter((l) => l.startsWith("Next: ")).length,
    }).toEqual({
      headline: `Calibre busy: ${busy.message}`,
      index: "Index: skipped — library busy",
      unreachable: false,
      code: ["Code: calibre_busy"],
      next: 1,
    });
  });
});
