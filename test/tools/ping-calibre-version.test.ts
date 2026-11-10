// calibre_ping reports the Calibre version on its own Labelled line + structuredContent (#499);
// an unknown version (binary missing, unparseable) degrades to "unknown", never an error.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { CalibreVersionInfo } from "../../src/domain/calibre-version.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { StatusIndex } from "../../src/semantic/status.js";
import { type PingDeps, pingTool as ping } from "../../src/tools/calibre_ping.js";
import type { ToolResult } from "../../src/tools/types.js";

function deps(version: CalibreVersionInfo, reachable = true): PingDeps {
  return {
    config: loadConfig({
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
      CALIBRE_MCP_CALIBREDB_PATH: "/opt/calibre/calibredb",
    }),
    content: {
      resolveLibraryId: async () => "Lib499",
      probeWriteAccess: async () => ({ access: "allowed" as const }),
      libraryInfo: async () => ({ libraryMap: { Lib499: "Lib 499" }, defaultLibrary: "Lib499" }),
      search: async () => ({ total: 0 }),
    } as unknown as ToolDeps["content"],
    calibre: {
      listLibraries: async () => {
        if (!reachable) throw new Error("connection refused");
        return "category,count\ntags,1";
      },
      calibreVersion: async () => version,
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
    index: {
      hasIndex: () => false,
      indexMeta: () => undefined,
      stats: () => ({ books: 0, chunks: 0, figures: 0 }),
      vectorCount: () => 0,
      booksMissingVectors: () => 0,
    } satisfies StatusIndex,
    log,
  };
}

const textOf = (r: ToolResult) => r.content.map((b) => ("text" in b ? b.text : "")).join("\n");
const lines = (r: ToolResult) => textOf(r).split("\n");
const v918 = parseCalibreVersion("Integration status: False\ncalibredb (calibre 9.18)\n");

describe("calibre_ping Calibre version (#499)", () => {
  it("should_print_the_version_on_its_own_labelled_line", async () => {
    expect(lines(await ping.handler({}, deps(v918)))).toContain("calibre version: 9.18");
  });

  it("should_mirror_the_version_in_structuredContent", async () => {
    const r = await ping.handler({}, deps(v918));
    expect(r.structuredContent).toMatchObject({ calibreVersion: "9.18" });
  });

  it("should_print_unknown_and_stay_ok_when_the_version_is_unknown", async () => {
    const r = await ping.handler({}, deps("unknown"));
    expect({ isError: r.isError === true, line: lines(r).includes("calibre version: unknown") }).toEqual({
      isError: false,
      line: true,
    });
    expect(r.structuredContent).toMatchObject({ calibreVersion: "unknown" });
  });

  it("should_keep_the_version_line_when_calibre_is_unreachable", async () => {
    expect(lines(await ping.handler({}, deps(v918, false)))).toContain("calibre version: 9.18");
  });
});
