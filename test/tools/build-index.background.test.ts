// Background-build outcomes at the tool level (#284 review): structuredContent says whose build
// is running, a cancelled background build never answers the next call, and a failed one
// reaches the model on the re-run in both channels.

import { afterEach, describe, expect, it } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { IndexBuildRegistry } from "../../src/semantic/index-builds.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";
const DEADLINE_MS = 40;

const book = (id: number): Book => ({
  id,
  uuid: `u-${id}`,
  title: `Book ${id}`,
  authors: ["Someone"],
  identifiers: {},
  formats: ["epub"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
});

const embedder: Embedder = {
  async embedQuery() {
    return new Float32Array(EMBED_DIM);
  },
  async embedPassages(texts) {
    return texts.map(() => {
      const v = new Float32Array(EMBED_DIM);
      v[0] = 1;
      return v;
    });
  },
  async warmup() {},
  countTokens: (s) => Math.ceil(s.length / 4) + 2,
};

const extracted = (): ExtractedText => {
  const text = "Ownership and borrowing in systems programming. ".repeat(40);
  return {
    text,
    backend: "ebook-convert",
    chars: text.length,
    cached: false,
    markers: [],
    unplaced: 0,
    outline: [],
    epubToc: null,
  };
};

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}
const gates: ReturnType<typeof gate>[] = [];

/** Deps whose extraction (and optional query listing) waits on a gate; extraction ignores abort. */
function deps(opts: { search?: () => Promise<never> } = {}) {
  const g = gate();
  gates.push(g);
  const calls: number[] = [];
  const d: ToolDeps & { index: SqliteIndexStore } = {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: {
      getBook: async (id: number) => book(id),
      resolveLibraryId: async () => LIB,
      search: async () => {
        await g.opened;
        return opts.search ? opts.search() : { bookIds: [], total: 0 };
      },
    } as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    // Ignores the abort signal: a cancel that lands in a phase that cannot be interrupted.
    extractor: {
      getText: async (a: { bookId: number }) => {
        calls.push(a.bookId);
        await g.opened;
        return extracted();
      },
    } as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder,
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    indexBuilds: new IndexBuildRegistry<ToolResult>({ softDeadlineMs: DEADLINE_MS }),
    log,
  };
  return { d, release: g.open, calls };
}

const args = (over: Record<string, unknown> = {}) => ({
  bookId: 1,
  force: false,
  enableFts: false,
  keywordOnly: false,
  prune: false,
  ...over,
});
const ctx = (signal = new AbortController().signal): ToolContext => ({ signal });
const text = (r: ToolResult) => (r.content[0] as { text: string }).text;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const g of gates.splice(0)) g.open();
});

describe("calibre_build_index background outcomes (#284)", () => {
  it("should_mark_a_still_running_result_for_this_selector_as_runningBuild_this", async () => {
    const { d } = deps();

    const r = await buildIndexTool.handler(args(), d, ctx());

    expect(r.structuredContent).toMatchObject({ stillRunning: true, runningBuild: "this" });
  });

  it("should_mark_another_selector_s_build_as_runningBuild_other_and_say_none_of_this_call_ran", async () => {
    const { d } = deps();
    await buildIndexTool.handler(args(), d, ctx());

    const r = await buildIndexTool.handler(args({ bookId: undefined, ids: [2] }), d, ctx());

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ stillRunning: true, runningBuild: "other" });
    expect(text(r)).toMatch(
      /None of this call's 1 book\(s\) is committed yet\. Re-run this call once that build finishes\./,
    );
    expect(text(r)).toMatch(
      /That other build \(not this call's selection\): Books so far: 0\/1 processed \(0 indexed, 0 failed\)/,
    );
  });

  it("should_build_fresh_instead_of_inheriting_a_cancelled_background_build", async () => {
    const { d, release, calls } = deps();
    const ac = new AbortController();
    const first = await buildIndexTool.handler(args({ force: true }), d, ctx(ac.signal));
    expect(first.structuredContent?.stillRunning).toBe(true);
    ac.abort();
    release();
    await pause(50);

    const r = await buildIndexTool.handler(args({ force: true }), d, ctx());

    expect(r.isError).toBeFalsy();
    expect(text(r)).not.toMatch(/cancelled/);
    expect(text(r)).toMatch(/^Indexed 1\/1 book\(s\)/);
    // The second call extracted again: it ran its own build.
    expect(calls).toEqual([1, 1]);
  });

  it("should_surface_a_background_build_failure_to_the_re_run_in_text_and_structuredContent", async () => {
    const { d, release } = deps({
      search: async () => {
        throw new Error("content server 503");
      },
    });
    const q = args({ bookId: undefined, query: "tag:rust" });
    const first = await buildIndexTool.handler(q, d, ctx());
    expect(first.structuredContent?.stillRunning).toBe(true);
    release();
    await pause(20);

    const r = await buildIndexTool.handler(q, d, ctx());

    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(
      /^Error: The background build an earlier call started failed (just now|\d+ s ago): content server 503\. /,
    );
    expect(text(r)).toMatch(/re-run the same call to retry/);
    expect(r.structuredContent).toEqual({
      backgroundBuildFailed: true,
      failures: ["content server 503"],
      errorCode: "index_build_failed",
      error: expect.stringContaining("content server 503"),
    });
  });
});
