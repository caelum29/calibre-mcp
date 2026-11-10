// enableFts is independent of the build outcome (#447 review): the FTS line and `fts` field ride
// on every result kind, and an enable that may have committed is verified, not reported failed.

import { afterEach, describe, expect, it } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { IndexBuildRegistry } from "../../src/semantic/index-builds.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { Book } from "../../src/domain/book.js";
import type { LibraryWriter } from "../../src/calibre/client.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";

const STATUS_DISABLED = "Integration status: False\nFTS Indexing is disabled\n";
const STATUS_ENABLED = "Integration status: False\nFTS Indexing is enabled\n0 of 144 books files indexed\n";
const ENABLE_OUT = "Integration status: False\nFTS indexing has been enabled\n0 of 144 books files indexed\n";

const book: Book = {
  id: 1,
  uuid: "u-1",
  title: "Book",
  authors: ["Someone"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
};

/** calibredb for a library whose FTS is off; `enable` is scripted per test. */
function ftsCalibre(enable: () => Promise<{ stdout: string; stderr: string }>, statusAfterEnable = false) {
  const calls: string[] = [];
  let enabled = false;
  const calibre: LibraryWriter = fakeCalibre({
    calibredb: async (args) => {
      calls.push(args.join(" "));
      if (args[1] === "status") {
        if (enabled) return { stdout: STATUS_ENABLED, stderr: "" };
        throw new CalibreCliError(2, "calibredb command failed", STATUS_DISABLED);
      }
      try {
        return await enable();
      } finally {
        enabled = statusAfterEnable;
      }
    },
  });
  return { calibre, calls };
}

let release!: () => void;
const gate = new Promise<void>((r) => (release = r));
afterEach(() => release());

function deps(calibre: LibraryWriter, searchIds: number[], gated: boolean): ToolDeps {
  const config = loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:", CALIBRE_MCP_ENABLE_WRITE: "1" });
  return {
    config,
    content: fakeContent({
      getBook: async () => book,
      resolveLibraryId: async () => asLibId("Programming_Books"),
      search: async () => ({
        bookIds: searchIds,
        total: searchIds.length,
        num: searchIds.length,
        offset: 0,
        sort: "",
        libraryId: "Programming_Books",
      }),
    }),
    calibre,
    extractor: fakeExtractor({
      getText: async () => {
        if (gated) await gate;
        return {
          text: "Ownership and borrowing. ".repeat(200),
          backend: "pdftotext",
          chars: 5000,
          cached: false,
          markers: [],
          unplaced: 0,
          outline: [],
          epubToc: null,
        };
      },
    }),
    figures: fakeFigures(),
    embedder: {
      embedQuery: async () => new Float32Array(1),
      embedPassages: async () => [],
      warmup: async () => {},
      countTokens: (s: string) => s.length,
    },
    index: new SqliteIndexStore(config),
    indexBuilds: new IndexBuildRegistry({ softDeadlineMs: 40 }),
    log,
  };
}

const args = { query: "all", force: false, enableFts: true, keywordOnly: true, prune: false };
const ctx: ToolContext = { signal: new AbortController().signal };
const textOf = (r: ToolResult) => (r.content[0] as { text: string }).text;
const ok = async () => ({ stdout: ENABLE_OUT, stderr: "" });

describe("enableFts on every result kind (#447)", () => {
  it("should_enable_once_and_report_fts_in_the_still_running_result", async () => {
    const { calibre, calls } = ftsCalibre(ok);
    const r = await buildIndexTool.handler(args, deps(calibre, [1], true), ctx);
    expect(r.structuredContent).toMatchObject({ stillRunning: true, fts: { status: "enabled" } });
    expect(textOf(r)).toContain("FTS: enabled");
    expect(calls).toEqual(["fts_index status", "fts_index enable"]);
  });

  it("should_report_fts_in_the_nothing_to_build_result", async () => {
    const { calibre, calls } = ftsCalibre(ok);
    const r = await buildIndexTool.handler(args, deps(calibre, [], false), ctx);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ fts: { status: "enabled" } });
    expect(textOf(r)).toContain("FTS: enabled");
    expect(calls).toEqual(["fts_index status", "fts_index enable"]);
  });
});

describe("enableFts verifies a possibly committed enable (#447)", () => {
  it("should_report_enabled_when_enable_times_out_but_status_then_says_enabled", async () => {
    const { calibre, calls } = ftsCalibre(async () => {
      throw new CalibreCliTimeoutError("calibredb command timed out");
    }, true);
    const r = await buildIndexTool.handler(args, deps(calibre, [], false), ctx);
    expect(r.structuredContent).toMatchObject({ fts: { status: "enabled" } });
    expect(calls).toEqual(["fts_index status", "fts_index enable", "fts_index status"]);
  });

  it("should_report_failed_with_a_steer_when_the_recheck_says_still_disabled", async () => {
    const { calibre } = ftsCalibre(async () => {
      throw new CalibreCliTimeoutError("calibredb command timed out");
    });
    const r = await buildIndexTool.handler(args, deps(calibre, [], false), ctx);
    expect(r.structuredContent).toMatchObject({ fts: { status: "failed" } });
    expect(textOf(r)).toContain("calibre_ping");
    expect(textOf(r)).toContain("FT button");
  });
});
