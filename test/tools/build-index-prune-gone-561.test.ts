// #561: with prune=true, a selected id that is gone from the library is reported once as removed
// and pruned, never as a failure. Real failures (404 for a live book, 5xx, extraction) still count.

import { describe, expect, it } from "vitest";
import { buildIndexTool, type BuildIndexDeps } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreHttpError } from "../../src/domain/errors.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import type { ToolResult } from "../../src/tools/types.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";

const LIB = "Programming_Books";
const GONE = 1377;

const book = (id: number): Book => ({
  id,
  uuid: `u-${id}`,
  title: `Book ${id}`,
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
});

const embedder: Embedder = {
  async embedQuery() {
    const v = new Float32Array(EMBED_DIM);
    v[0] = 1;
    return l2normalize(v);
  },
  async embedPassages(texts: string[]) {
    return texts.map(() => {
      const v = new Float32Array(EMBED_DIM);
      v[0] = 1;
      return l2normalize(v);
    });
  },
  async warmup() {},
  countTokens: (s: string) => Math.ceil(s.length / 4) + 2,
};

interface Opts {
  /** Ids the library lists (the prune keep-set). */
  live: number[];
  /** getBook failure per id; ids without one read back as a book. */
  getBookError?: Record<number, Error>;
  /** Extraction failure per id. */
  extractError?: Record<number, Error>;
}

function deps(o: Opts, store: SqliteIndexStore): BuildIndexDeps {
  const content = fakeContent({
    getBook: async (id: number): Promise<Book> => {
      const err = o.getBookError?.[id];
      if (err) throw err;
      return book(id);
    },
    resolveLibraryId: async () => asLibId(LIB),
    search: async (p) => {
      const offset = p.offset ?? 0;
      const page = o.live.slice(offset, offset + (p.num ?? 100));
      return { bookIds: page, total: o.live.length, num: page.length, offset, sort: "", libraryId: LIB };
    },
  });
  const extractor = fakeExtractor({
    getText: async (a: { bookId: number }): Promise<ExtractedText> => {
      const err = o.extractError?.[a.bookId];
      if (err) throw err;
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
  });
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content,
    calibre: fakeCalibre(),
    extractor,
    figures: fakeFigures(),
    embedder,
    index: store,
    log,
  };
}

/** An index already holding the removed book's rows (indexed before calibre_remove_book). */
function storeWithGone(): SqliteIndexStore {
  const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  store.replaceBook(LIB, { bookId: GONE, title: "Scratch", authors: ["Ghost"], lastModified: "2026-01-01" }, [
    { charStart: 0, charEnd: 20, body: "scratch passage", frontMatter: false },
  ]);
  return store;
}

const args = (over: Record<string, unknown>) => ({
  force: false,
  enableFts: false,
  keywordOnly: false,
  prune: false,
  ...over,
});
const text = (r: ToolResult) => (r.content[0] as { text: string }).text;
const notFound = () => new CalibreHttpError(404, "http://x/ajax/book", "HTTP 404");

describe("calibre_build_index prune=true with a removed id in the selection (#561)", () => {
  it("should_report_a_removed_selected_id_as_removed_and_pruned_not_as_a_failure", async () => {
    const store = storeWithGone();
    const r = await buildIndexTool.handler(
      args({ ids: [1, GONE], prune: true }),
      deps({ live: [1], getBookError: { [GONE]: notFound() } }, store),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      booksRequested: 2,
      booksIndexed: 1,
      failures: [],
      removedIds: [GONE],
      prunedBooks: 1,
    });
    expect(text(r)).not.toContain("failed");
    expect(text(r)).not.toContain("HTTP 404");
    // one mention of the removed id in the text, with what happened to it
    expect(text(r).match(/#1377/g)).toHaveLength(1);
    expect(text(r)).toContain(
      "Selected but no longer in the library: #1377 — removed from the index, not counted as failed.",
    );
    expect(store.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([1]);
  });

  it("should_clean_up_cleanly_when_only_removed_ids_are_selected", async () => {
    const store = storeWithGone();
    const r = await buildIndexTool.handler(
      args({ ids: [GONE], prune: true }),
      deps({ live: [1], getBookError: { [GONE]: notFound() } }, store),
    );
    expect(r.structuredContent).toMatchObject({ booksIndexed: 0, failures: [], removedIds: [GONE] });
    expect(store.indexedBookIds(LIB)).toEqual([]);
  });

  it("should_still_count_the_404_as_a_failure_without_prune", async () => {
    const r = await buildIndexTool.handler(
      args({ ids: [1, GONE] }),
      deps({ live: [1], getBookError: { [GONE]: notFound() } }, storeWithGone()),
    );
    expect(r.structuredContent?.failures).toEqual([`book ${GONE}: HTTP 404`]);
    expect(r.structuredContent?.removedIds).toBeUndefined();
  });

  it("should_still_count_a_404_for_a_book_the_library_still_holds", async () => {
    const r = await buildIndexTool.handler(
      args({ ids: [1, 2], prune: true }),
      deps({ live: [1, 2], getBookError: { 2: notFound() } }, storeWithGone()),
    );
    expect(r.structuredContent?.failures).toEqual(["book 2: HTTP 404"]);
    expect(r.structuredContent?.removedIds).toBeUndefined();
  });

  it("should_still_count_a_5xx_for_a_book_gone_from_the_listing", async () => {
    const r = await buildIndexTool.handler(
      args({ ids: [1, GONE], prune: true }),
      deps({ live: [1], getBookError: { [GONE]: new CalibreHttpError(503, "http://x", "HTTP 503") } }, storeWithGone()),
    );
    expect(r.structuredContent?.failures).toEqual([`book ${GONE}: HTTP 503`]);
    expect(r.structuredContent?.removedIds).toBeUndefined();
  });

  it("should_still_count_an_extraction_error_for_a_live_book", async () => {
    const r = await buildIndexTool.handler(
      args({ ids: [1, 2], prune: true }),
      deps({ live: [1, 2], extractError: { 2: new Error("EXTRACT_FAILED") } }, storeWithGone()),
    );
    expect(r.structuredContent?.failures).toEqual(["book 2: extraction failed"]);
    expect(r.structuredContent?.removedIds).toBeUndefined();
  });

  it("should_keep_the_404_a_failure_when_the_prune_was_skipped", async () => {
    // an empty listing makes the prune refuse: gone-ness is then unknown
    const r = await buildIndexTool.handler(
      args({ ids: [GONE], prune: true }),
      deps({ live: [], getBookError: { [GONE]: notFound() } }, storeWithGone()),
    );
    expect(r.structuredContent?.failures).toEqual([`book ${GONE}: HTTP 404`]);
    expect(r.structuredContent?.removedIds).toBeUndefined();
  });
});
