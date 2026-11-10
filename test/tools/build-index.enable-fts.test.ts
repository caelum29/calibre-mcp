// enableFts on calibre_build_index (#447): turns on Calibre's own FTS through the routed write
// path, gated by CALIBRE_MCP_ENABLE_WRITE. The calibredb outputs below are the byte-for-byte
// probe captures (Calibre 9.18, GUI open, docs/dev/probes/447/), never hand-written.

import { describe, expect, it } from "vitest";
import { buildIndexTool, type BuildIndexDeps } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { Book } from "../../src/domain/book.js";
import type { LibraryWriter } from "../../src/calibre/client.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";

const ENABLE_OUT = "Integration status: False\nFTS indexing has been enabled\n0 of 144 books files indexed\n";
const STATUS_ENABLED = "Integration status: False\nFTS Indexing is enabled\n0 of 144 books files indexed\n";
const STATUS_DISABLED = "Integration status: False\nFTS Indexing is disabled\n"; // exit 2 on a disabled library

const book: Book = {
  id: 1,
  uuid: "u-1",
  title: "Rust in Action",
  authors: ["Tim"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
};

type Call = { args: readonly string[]; library: string };

/** A calibredb that records its calls and answers `fts_index` like the probed Calibre. */
function fakeFtsCalibredb(opts: { enabled: boolean; enableFails?: boolean }): {
  calibre: LibraryWriter;
  calls: Call[];
} {
  const calls: Call[] = [];
  const calibre = fakeCalibre({
    calibredb: async (args, o) => {
      calls.push({ args, library: o.library });
      if (args[0] === "fts_index" && args[1] === "status") {
        if (opts.enabled) return { stdout: STATUS_ENABLED, stderr: "" };
        throw new CalibreCliError(2, "calibredb command failed", STATUS_DISABLED);
      }
      if (args[0] === "fts_index" && args[1] === "enable") {
        if (opts.enableFails) throw new CalibreCliError(1, "calibredb command failed", "boom");
        return { stdout: ENABLE_OUT, stderr: "" };
      }
      throw new Error(`unexpected calibredb call: ${args.join(" ")}`);
    },
  });
  return { calibre, calls };
}

function deps(calibre: LibraryWriter, env: NodeJS.ProcessEnv): BuildIndexDeps {
  const config = loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:", ...env });
  return {
    config,
    content: fakeContent({
      getBook: async () => book,
      resolveLibraryId: async () => asLibId("Programming_Books"),
    }),
    calibre,
    extractor: fakeExtractor({
      getText: async () => ({
        text: "Ownership and borrowing. ".repeat(200),
        backend: "pdftotext",
        chars: 5000,
        cached: false,
        markers: [],
        unplaced: 0,
        outline: [],
        epubToc: null,
      }),
    }),
    figures: fakeFigures(),
    embedder: {
      embedQuery: async () => new Float32Array(1),
      embedPassages: async () => [],
      warmup: async () => {},
      countTokens: (s: string) => s.length,
    },
    index: new SqliteIndexStore(config),
    log,
  };
}

const args = { bookId: 1, force: false, enableFts: true, keywordOnly: true, prune: false };
const textOf = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

describe("calibre_build_index enableFts (#447)", () => {
  it("should_refuse_the_fts_part_without_spawning_calibredb_when_the_write_gate_is_off", async () => {
    const { calibre, calls } = fakeFtsCalibredb({ enabled: false });
    const r = await buildIndexTool.handler(args, deps(calibre, {}));
    expect(calls).toEqual([]);
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, fts: { status: "write_disabled" } });
    expect(textOf(r)).toContain("write_disabled");
    expect(textOf(r)).toContain("CALIBRE_MCP_ENABLE_WRITE=1");
    expect(textOf(r)).toContain("FT button");
  });

  it("should_enable_fts_through_the_routed_path_when_the_gate_is_on_and_fts_is_off", async () => {
    const { calibre, calls } = fakeFtsCalibredb({ enabled: false });
    const r = await buildIndexTool.handler(args, deps(calibre, { CALIBRE_MCP_ENABLE_WRITE: "1" }));
    expect(calls.map((c) => c.args.join(" "))).toEqual(["fts_index status", "fts_index enable"]);
    expect(calls.map((c) => c.library)).toEqual(["Programming_Books", "Programming_Books"]);
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, fts: { status: "enabled" } });
    expect(textOf(r)).toContain("0 of 144 books files indexed");
    expect(textOf(r)).not.toContain("Integration status");
  });

  it("should_be_a_no_op_that_says_so_when_fts_is_already_enabled", async () => {
    const { calibre, calls } = fakeFtsCalibredb({ enabled: true });
    const r = await buildIndexTool.handler(args, deps(calibre, { CALIBRE_MCP_ENABLE_WRITE: "1" }));
    expect(calls.map((c) => c.args.join(" "))).toEqual(["fts_index status"]);
    expect(r.structuredContent).toMatchObject({ fts: { status: "already_enabled" } });
    expect(textOf(r)).toContain("already enabled");
  });

  it("should_report_a_failed_enable_in_the_fts_line_without_failing_the_semantic_build", async () => {
    const { calibre } = fakeFtsCalibredb({ enabled: false, enableFails: true });
    const r = await buildIndexTool.handler(args, deps(calibre, { CALIBRE_MCP_ENABLE_WRITE: "1" }));
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, fts: { status: "failed" } });
    expect(textOf(r)).toContain("FTS");
  });

  it("should_not_touch_calibredb_or_report_fts_when_enableFts_is_false", async () => {
    const { calibre, calls } = fakeFtsCalibredb({ enabled: false });
    const r = await buildIndexTool.handler(
      { ...args, enableFts: false },
      deps(calibre, { CALIBRE_MCP_ENABLE_WRITE: "1" }),
    );
    expect(calls).toEqual([]);
    expect(r.structuredContent).not.toHaveProperty("fts");
  });
});
