// Soft-deadline early return (#284): a client that never resets its request timeout on progress
// must get a success-shaped "still running" result before it times out, while the build keeps
// committing in the background — and a re-run must never start a second build on the same library.

import { afterEach, describe, expect, it } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { IndexBuildRegistry } from "../../src/semantic/index-builds.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";
/** Short real deadline: the fake extraction is gated, so it outlasts this unless released. */
const DEADLINE_MS = 40;
/** How long a test waits for a handler that should return near the deadline. */
const SETTLE_MS = 1_000;

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

/** Extraction that blocks until `release()` (or rejects on the call's abort signal). */
function gatedExtractor() {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const calls: number[] = [];
  return {
    calls,
    release: () => open(),
    getText: async (a: { bookId: number; signal?: AbortSignal }): Promise<ExtractedText> => {
      calls.push(a.bookId);
      await new Promise<void>((resolve, reject) => {
        void gate.then(resolve);
        a.signal?.addEventListener("abort", () => reject(a.signal?.reason ?? new Error("aborted")), { once: true });
      });
      return extracted();
    },
  };
}

type Gated = ReturnType<typeof gatedExtractor>;
const drains: Gated[] = [];

function deps(ex: Gated, softDeadlineMs = DEADLINE_MS): ToolDeps & { index: SqliteIndexStore } {
  drains.push(ex);
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: {
      getBook: async (id: number) => book(id),
      resolveLibraryId: async () => LIB,
    } as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: { getText: ex.getText } as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder,
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    indexBuilds: new IndexBuildRegistry({ softDeadlineMs }),
    log,
  };
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

/** The handler's result if it settles within `ms`, else "pending". */
async function within(p: Promise<ToolResult>, ms = SETTLE_MS): Promise<ToolResult | "pending"> {
  let timer: NodeJS.Timeout | undefined;
  const pending = new Promise<"pending">((resolve) => (timer = setTimeout(() => resolve("pending"), ms)));
  try {
    return await Promise.race([p, pending]);
  } finally {
    clearTimeout(timer);
  }
}

/** Wait (bounded) until the background build has committed `bookId`. */
async function committed(d: ToolDeps & { index: SqliteIndexStore }, bookId: number): Promise<boolean> {
  for (let i = 0; i < 200; i++) {
    if (d.index.indexedBookIds(LIB).includes(bookId)) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}

afterEach(() => {
  // Never leave a gated background build hanging into the next test.
  for (const ex of drains.splice(0)) ex.release();
});

describe("calibre_build_index soft deadline (#284)", () => {
  it("should_return_a_success_shaped_still_running_result_when_one_book_outlasts_the_soft_deadline", async () => {
    const ex = gatedExtractor();
    const d = deps(ex);

    const r = await within(buildIndexTool.handler(args(), d, ctx()));

    expect(r).not.toBe("pending");
    const res = r as ToolResult;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ stillRunning: true, booksRequested: 1, booksDone: 0 });
    expect(text(res)).toMatch(/^Index build still running in the background/);
    expect(text(res)).toMatch(/not an error/);
    expect(text(res)).toMatch(/re-run the same call/i);
    expect(text(res)).toMatch(/0\/1 processed \(0 indexed, 0 failed\)/);
    // Nothing is committed yet: the only book is still extracting.
    expect(d.index.indexedBookIds(LIB)).toEqual([]);
  });

  it("should_report_the_committed_book_on_the_re_run_after_the_background_build_finishes", async () => {
    const ex = gatedExtractor();
    const d = deps(ex);
    const first = await within(buildIndexTool.handler(args(), d, ctx()));
    expect((first as ToolResult).structuredContent?.stillRunning).toBe(true);

    ex.release();
    expect(await committed(d, 1)).toBe(true);
    const again = await within(buildIndexTool.handler(args(), d, ctx()));

    const res = again as ToolResult;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ booksRequested: 1, booksIndexed: 1 });
    expect(res.structuredContent?.stillRunning).toBeUndefined();
    expect(text(res)).toMatch(/Indexed 1\/1 book\(s\)/);
    expect(text(res)).toMatch(/Indexed ids: 1\./);
    // The re-run reported the background build — it did not extract the book a second time.
    expect(ex.calls).toEqual([1]);
  });

  it("should_not_start_a_parallel_build_when_the_same_call_is_re_run_while_the_first_is_running", async () => {
    const ex = gatedExtractor();
    const d = deps(ex);
    await within(buildIndexTool.handler(args(), d, ctx()));

    const again = await within(buildIndexTool.handler(args(), d, ctx()));

    const res = again as ToolResult;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ stillRunning: true });
    expect(text(res)).toMatch(/^Index build still running in the background/);
    expect(ex.calls).toEqual([1]);
  });

  it("should_not_start_a_parallel_build_for_a_different_selector_on_the_same_library", async () => {
    const ex = gatedExtractor();
    const d = deps(ex);
    await within(buildIndexTool.handler(args(), d, ctx()));

    const other = await within(buildIndexTool.handler(args({ bookId: undefined, ids: [2] }), d, ctx()));

    const res = other as ToolResult;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ stillRunning: true, booksRequested: 1, booksDone: 0 });
    expect(text(res)).toMatch(/^Another index build for this library is still running/);
    expect(text(res)).toMatch(/did not start a second build/);
    expect(ex.calls).toEqual([1]);
  });

  it("should_hand_the_final_result_to_a_re_run_that_was_waiting_when_the_build_finished", async () => {
    const ex = gatedExtractor();
    const d = deps(ex, 300);
    await within(buildIndexTool.handler(args(), d, ctx()));

    const waiting = buildIndexTool.handler(args(), d, ctx());
    ex.release();
    const res = (await within(waiting)) as ToolResult;

    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/Indexed 1\/1 book\(s\)/);
    expect(text(res)).toMatch(/Indexed ids: 1\./);
    expect(ex.calls).toEqual([1]);
  });

  it("should_send_no_progress_after_the_early_return", async () => {
    const ex = gatedExtractor();
    const d = deps(ex);
    const sent: string[] = [];
    const progressCtx: ToolContext = { signal: new AbortController().signal, progress: (_v, m) => sent.push(m) };
    await within(buildIndexTool.handler(args(), d, progressCtx));
    const atReturn = sent.length;

    ex.release();
    expect(await committed(d, 1)).toBe(true);

    expect(atReturn).toBeGreaterThan(0);
    expect(sent.length).toBe(atReturn);
  });

  it("should_free_the_library_for_a_new_build_after_a_cancel_before_the_deadline", async () => {
    const ex = gatedExtractor();
    const d = deps(ex, 300);
    const ac = new AbortController();
    const first = buildIndexTool.handler(args(), d, ctx(ac.signal));
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    const cancelled = (await within(first)) as ToolResult;
    expect(cancelled.isError).toBe(true);
    expect(text(cancelled)).toMatch(/^Error: Index build cancelled/);

    const next = buildIndexTool.handler(args(), d, ctx());
    ex.release();
    const res = (await within(next)) as ToolResult;

    expect(text(res)).toMatch(/Indexed 1\/1 book\(s\)/);
    expect(ex.calls).toEqual([1, 1]);
  });

  it("should_leave_the_running_build_alone_when_a_waiting_re_run_is_cancelled", async () => {
    const ex = gatedExtractor();
    const d = deps(ex, 300);
    await within(buildIndexTool.handler(args(), d, ctx()));
    const ac = new AbortController();
    const waiting = buildIndexTool.handler(args(), d, ctx(ac.signal));

    ac.abort();
    const res = await within(waiting, 150);

    expect(res).not.toBe("pending");
    expect((res as ToolResult).structuredContent?.stillRunning).toBe(true);
    ex.release();
    expect(await committed(d, 1)).toBe(true);
    expect(ex.calls).toEqual([1]);
  });
});

/**
 * Extraction scripted per book: listed `fail` ids reject at once, `gate` ids block until
 * `release()`, every other id extracts at once — so a build can commit, fail and then stall.
 */
function scriptedExtractor(script: { fail?: Record<number, string>; gate: number[] }): Gated {
  const g = gatedExtractor();
  return {
    ...g,
    getText: async (a: { bookId: number; signal?: AbortSignal }): Promise<ExtractedText> => {
      const reason = script.fail?.[a.bookId];
      if (reason !== undefined) {
        g.calls.push(a.bookId);
        throw new Error(reason);
      }
      if (script.gate.includes(a.bookId)) return g.getText(a);
      g.calls.push(a.bookId);
      return extracted();
    },
  };
}

describe("calibre_build_index still-running messages (#284 live check)", () => {
  it("should_count_failures_apart_from_indexed_books_and_list_them_in_the_progress_text", async () => {
    // Live run: 6/11 "finished" came with only 5 committed ids — the 6th had failed.
    const ex = scriptedExtractor({ fail: { 12: "no extractable text (pdf)" }, gate: [11] });
    const d = deps(ex, 300);

    const r = (await within(
      buildIndexTool.handler(args({ bookId: undefined, ids: [7, 10, 8, 6, 9, 12, 11] }), d, ctx()),
    )) as ToolResult;

    expect(r.structuredContent).toMatchObject({ stillRunning: true, booksDone: 6, booksIndexed: 5 });
    expect(text(r)).toContain("6/7 processed (5 indexed, 1 failed)");
    expect(text(r)).toContain("Committed so far: ids 7, 10, 8, 6, 9.");
    expect(text(r)).toContain("Failed so far: book 12: no extractable text (pdf).");
    expect(r.structuredContent?.failures).toEqual(["book 12: no extractable text (pdf)"]);
  });

  it("should_say_a_refused_book_is_already_committed_and_covered_when_it_is_part_of_the_running_build", async () => {
    // Live run: bookId 9 was in "Committed so far", yet the refusal said none of it was indexed.
    const ex = scriptedExtractor({ gate: [11] });
    const d = deps(ex, 300);
    await within(buildIndexTool.handler(args({ bookId: undefined, ids: [7, 9, 11] }), d, ctx()));

    const r = (await within(buildIndexTool.handler(args({ bookId: 9 }), d, ctx()))) as ToolResult;

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ stillRunning: true, runningBuild: "other" });
    expect(text(r)).toContain("1 of this call's 1 book(s) is already committed by the running build (id 9).");
    expect(text(r)).toContain("will be covered when that build finishes");
    expect(text(r)).not.toContain("none of this call's books have been indexed yet");
  });

  it("should_name_only_the_committed_overlap_when_the_refused_selection_is_not_inside_the_running_build", async () => {
    const ex = scriptedExtractor({ gate: [11] });
    const d = deps(ex, 300);
    await within(buildIndexTool.handler(args({ bookId: undefined, ids: [7, 9, 11] }), d, ctx()));

    const r = (await within(
      buildIndexTool.handler(args({ bookId: undefined, ids: [9, 4, 5] }), d, ctx()),
    )) as ToolResult;

    expect(text(r)).toContain("1 of this call's 3 book(s) is already committed by the running build (id 9).");
    expect(text(r)).not.toContain("will be covered when that build finishes");
    expect(text(r)).toContain("Re-run this call once that build finishes.");
  });

  it("should_say_a_not_yet_committed_selection_inside_the_running_build_will_be_covered", async () => {
    const ex = scriptedExtractor({ gate: [11] });
    const d = deps(ex, 300);
    await within(buildIndexTool.handler(args({ bookId: undefined, ids: [7, 11, 13] }), d, ctx()));

    const r = (await within(
      buildIndexTool.handler(args({ bookId: undefined, ids: [13, 11] }), d, ctx()),
    )) as ToolResult;

    expect(text(r)).toContain("None of this call's 2 book(s) is committed yet.");
    expect(text(r)).toContain("will be covered when that build finishes");
  });

  it("should_not_claim_anything_about_a_query_selection_it_did_not_resolve", async () => {
    const ex = scriptedExtractor({ gate: [11] });
    const d = deps(ex, 300);
    await within(buildIndexTool.handler(args({ bookId: undefined, ids: [7, 11] }), d, ctx()));

    const r = (await within(
      buildIndexTool.handler(args({ bookId: undefined, query: "tags:rust" }), d, ctx()),
    )) as ToolResult;

    expect(text(r)).toContain("This call's selection (a query) was not checked against that build.");
    expect(text(r)).not.toContain("none of this call's books have been indexed yet");
  });
});

describe("calibre_build_index refusal coverage needs the same build mode (#284 review)", () => {
  it("should_not_promise_coverage_when_the_refused_call_forces_books_the_running_build_does_not", async () => {
    // Running build = ids 7, 11, 13 without force; force:true on 11, 13 is different work.
    const ex = scriptedExtractor({ gate: [11] });
    const d = deps(ex, 300);
    await within(buildIndexTool.handler(args({ bookId: undefined, ids: [7, 11, 13] }), d, ctx()));

    const r = (await within(
      buildIndexTool.handler(args({ bookId: undefined, ids: [11, 13], force: true }), d, ctx()),
    )) as ToolResult;

    expect(text(r)).toContain(
      "None of this call's 2 book(s) is committed yet. Re-run this call once that build finishes.",
    );
    expect(text(r)).not.toContain("will be covered when that build finishes");
  });

  it("should_warn_that_a_covered_book_can_still_fail", async () => {
    const ex = scriptedExtractor({ gate: [11] });
    const d = deps(ex, 300);
    await within(buildIndexTool.handler(args({ bookId: undefined, ids: [7, 11, 13] }), d, ctx()));

    const r = (await within(
      buildIndexTool.handler(args({ bookId: undefined, ids: [13, 11] }), d, ctx()),
    )) as ToolResult;

    expect(text(r)).toContain("will be covered when that build finishes (unless one fails)");
  });
});
