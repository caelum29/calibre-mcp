// build_index progress counts (#312 → #325): a book whose keyword-only write is refused at commit
// (it got embeddings meanwhile) is not "indexed", and books cut short by a cancel are not counted
// as processed — so "N already in the index" can't swallow them.

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import type { BuildProgress, IndexBuilds } from "../../src/semantic/index-builds.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { ToolResult } from "../../src/tools/types.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";

const LIB = "Programming_Books";

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
    return texts.map(() => new Float32Array(EMBED_DIM).fill(0.1));
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

/**
 * Runs the build to the end, then answers as if the soft deadline had passed — so the handler
 * formats the "still running" text from the build's final progress, with no timers involved.
 */
const reportAsRunning: IndexBuilds<ToolResult> = {
  softDeadlineMs: 0,
  async run(_libraryId, _key, build) {
    const progress: BuildProgress = { done: 0, total: 0, indexedIds: [], selectedIds: [], failures: [], mode: "" };
    await build({ progress, detached: () => true });
    return { kind: "running", progress, sameSelector: true };
  },
};

function deps(
  getText: (a: { bookId: number; signal?: AbortSignal }) => Promise<ExtractedText>,
  index: SqliteIndexStore,
) {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: fakeContent({
      getBook: async (id: number) => book(id),
      resolveLibraryId: async () => asLibId(LIB),
    }),
    calibre: fakeCalibre(),
    extractor: fakeExtractor({ getText }),
    figures: fakeFigures(),
    embedder,
    index,
    indexBuilds: reportAsRunning,
    log,
  };
}

const args = (over: Record<string, unknown>) => ({
  force: false,
  enableFts: false,
  keywordOnly: false,
  prune: false,
  ...over,
});
const text = (r: ToolResult) => (r.content[0] as { text: string }).text;
const store = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));

afterEach(() => vi.restoreAllMocks());

describe("calibre_build_index progress counts (#312)", () => {
  it("should_not_count_a_book_refused_at_commit_as_indexed", async () => {
    const index = store();
    const replace = index.replaceBook.bind(index);
    // Book 8 got embeddings from another writer meanwhile: the keyword-only write is refused.
    vi.spyOn(index, "replaceBook").mockImplementation((lib, meta, ...rest) =>
      meta.bookId === 8 ? "preserved" : replace(lib, meta, ...rest),
    );
    const r = await buildIndexTool.handler(
      args({ ids: [7, 8, 9], keywordOnly: true }),
      deps(async () => extracted(), index),
      { signal: new AbortController().signal },
    );
    expect({ text: text(r), sc: r.structuredContent }).toMatchObject({
      text: expect.stringContaining(
        "Books so far: 3/3 processed (2 indexed, 0 failed, 1 already in the index). Committed so far: ids 7, 9.",
      ),
      sc: { booksDone: 3, booksIndexed: 2, indexedIds: [7, 9] },
    });
  });

  it("should_not_count_books_cut_short_by_a_cancel_as_already_in_the_index", async () => {
    const ac = new AbortController();
    const getText = async (a: { bookId: number; signal?: AbortSignal }) => {
      if (a.bookId === 11) {
        ac.abort(); // the client cancels while book 11 is extracting
        throw new Error("aborted");
      }
      return extracted();
    };
    const r = await buildIndexTool.handler(args({ ids: [7, 11, 12] }), deps(getText, store()), {
      signal: ac.signal,
    });
    expect({ text: text(r), sc: r.structuredContent }).toMatchObject({
      text: expect.stringContaining("Books so far: 1/3 processed (1 indexed, 0 failed). Committed so far: ids 7."),
      sc: { booksDone: 1, booksIndexed: 1, indexedIds: [7] },
    });
  });
});

/** Runs the build to the end and returns its own result; `last.progress` keeps the final progress. */
function capture() {
  const last: { progress?: BuildProgress } = {};
  const builds: IndexBuilds<ToolResult> = {
    softDeadlineMs: 0,
    async run(_libraryId, _key, build) {
      const progress: BuildProgress = { done: 0, total: 0, indexedIds: [], selectedIds: [], failures: [], mode: "" };
      last.progress = progress;
      return { kind: "done", result: await build({ progress, detached: () => true }) };
    },
  };
  return { builds, last };
}

const progressOf = (p: BuildProgress | undefined) => ({
  done: p?.done,
  indexedIds: p?.indexedIds,
  failures: p?.failures,
});

describe("calibre_build_index cancel summary agrees with progress (#325 review)", () => {
  it("should_report_books_refused_at_commit_in_the_cancelled_result", async () => {
    // 1 ok, 2 refused at commit, 3 ok, 4 cut short by the cancel, 5 never started.
    const ac = new AbortController();
    const index = store();
    const replace = index.replaceBook.bind(index);
    vi.spyOn(index, "replaceBook").mockImplementation((lib, meta, ...rest) =>
      meta.bookId === 2 ? "preserved" : replace(lib, meta, ...rest),
    );
    const getText = async (a: { bookId: number }) => {
      if (a.bookId === 4) {
        ac.abort();
        throw new Error("aborted");
      }
      return extracted();
    };
    const { builds, last } = capture();
    const r = await buildIndexTool.handler(
      args({ ids: [1, 2, 3, 4, 5], keywordOnly: true }),
      { ...deps(getText, index), indexBuilds: builds },
      { signal: ac.signal },
    );
    expect({ text: text(r), sc: r.structuredContent, progress: progressOf(last.progress) }).toMatchObject({
      text: expect.stringContaining(
        "Index build cancelled after 3/5 book(s) (2 indexed, 0 failed, 1 already in the index).",
      ),
      sc: { cancelled: true, booksDone: 3, booksIndexed: 2, booksSkipped: 0, booksPreserved: 1, failures: [] },
      progress: { done: 3, indexedIds: [1, 3], failures: [] },
    });
  });

  it("should_count_a_commit_failure_during_the_cancel_as_failed_not_cut_short", async () => {
    const ac = new AbortController();
    const index = store();
    const replace = index.replaceBook.bind(index);
    vi.spyOn(index, "replaceBook").mockImplementation((lib, meta, ...rest) => {
      if (meta.bookId !== 2) return replace(lib, meta, ...rest);
      ac.abort(); // the cancel lands while book 2 commits — and that commit really fails
      throw new Error("disk full");
    });
    const { builds, last } = capture();
    const r = await buildIndexTool.handler(
      args({ ids: [1, 2, 3] }),
      { ...deps(async () => extracted(), index), indexBuilds: builds },
      { signal: ac.signal },
    );
    expect({ text: text(r), sc: r.structuredContent, progress: progressOf(last.progress) }).toMatchObject({
      text: expect.stringContaining("Index build cancelled after 2/3 book(s) (1 indexed, 1 failed)."),
      sc: { cancelled: true, booksDone: 2, booksIndexed: 1, failures: ["book 2: disk full"] },
      progress: { done: 2, indexedIds: [1], failures: ["book 2: disk full"] },
    });
  });

  it("should_count_a_book_committed_during_the_cancel_as_indexed", async () => {
    const ac = new AbortController();
    const index = store();
    const replace = index.replaceBook.bind(index);
    vi.spyOn(index, "replaceBook").mockImplementation((lib, meta, ...rest) => {
      if (meta.bookId === 2) ac.abort(); // the cancel lands while book 2 commits; the commit succeeds
      return replace(lib, meta, ...rest);
    });
    const { builds, last } = capture();
    const r = await buildIndexTool.handler(
      args({ ids: [1, 2, 3] }),
      { ...deps(async () => extracted(), index), indexBuilds: builds },
      { signal: ac.signal },
    );
    expect({ text: text(r), sc: r.structuredContent, progress: progressOf(last.progress) }).toMatchObject({
      text: expect.stringContaining("Index build cancelled after 2/3 book(s) (2 indexed, 0 failed)."),
      sc: { cancelled: true, booksDone: 2, booksIndexed: 2, failures: [] },
      progress: { done: 2, indexedIds: [1, 2], failures: [] },
    });
  });
});
