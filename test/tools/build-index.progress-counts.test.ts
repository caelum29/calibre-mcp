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
import type { ToolDeps } from "../../src/tools/deps.js";

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
    content: {
      getBook: async (id: number) => book(id),
      resolveLibraryId: async () => LIB,
    } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: { getText } satisfies Partial<ToolDeps["extractor"]> as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
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
