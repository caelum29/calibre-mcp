// #715 review guards for the metadata row (#631): it shares the book's transaction (a throw
// after the chunks leaves neither), a prune drops it with its FTS entry, and a keyword-only pass
// over an embedded book never nulls its vector. Behaviour the PR already has; pinned here.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { IndexedFigure } from "../../src/semantic/store/index.js";
import { commitBook, prepareBook, type PrepareOptions } from "../../src/app/index-book.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";
const TEXT = "Closures capture variables from the enclosing scope. ".repeat(60);
const META = { bookId: 7, title: "Seven", authors: ["A. Author"], lastModified: "2026-01-01" };
const unit = () => {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return v;
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-meta-631-guards-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const openStore = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));

/** Row counts per table, read from the closed index file. */
function counts(store: SqliteIndexStore) {
  store.close();
  const db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
  try {
    const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    return {
      chunks: n("SELECT count(*) AS n FROM chunks"),
      metadata: n("SELECT count(*) AS n FROM book_metadata"),
      metadataFts: n("SELECT count(*) AS n FROM book_metadata_fts WHERE book_metadata_fts MATCH 'body:seven'"),
      vectors: n("SELECT count(*) AS n FROM book_metadata WHERE vector IS NOT NULL"),
    };
  } finally {
    db.close();
  }
}

describe("metadata row guards (#631, #715 review)", () => {
  it("should_leave_neither_chunks_nor_row_when_the_write_throws_after_the_chunks", () => {
    const store = openStore();
    // A figure whose caption can't be stemmed fails after the row and the chunks were inserted.
    const bad = { figIndex: 0, page: 1, caption: null, charOffset: 0, format: "pdf" } as unknown as IndexedFigure;
    expect(() =>
      store.replaceBook(LIB, META, [{ charStart: 0, charEnd: 5, body: "Seven", vector: unit() }], [bad], {
        metadata: { text: "Seven\nA. Author", blurbChars: 0, vector: unit() },
      }),
    ).toThrow();
    expect(counts(store)).toEqual({ chunks: 0, metadata: 0, metadataFts: 0, vectors: 0 });
  });

  it("should_drop_the_row_and_its_fts_entry_when_a_prune_deletes_the_book", () => {
    const store = openStore();
    store.replaceBook(LIB, META, [{ charStart: 0, charEnd: 5, body: "Seven" }], [], {
      metadata: { text: "Seven\nA. Author", blurbChars: 0 },
    });
    // The prune path: indexed ids the library no longer holds go through deleteBooks.
    const live = new Set<number>();
    store.deleteBooks(
      LIB,
      store.indexedBookIds(LIB).filter((id) => !live.has(id)),
    );
    expect(counts(store)).toEqual({ chunks: 0, metadata: 0, metadataFts: 0, vectors: 0 });
  });
});

describe("keyword-only pass over an embedded book (#631, #715 review)", () => {
  let book: Book;
  beforeEach(() => {
    book = {
      id: 7,
      uuid: "u-7",
      title: "Seven",
      authors: ["A. Author"],
      comments: "<p>First blurb.</p>",
      identifiers: {},
      formats: ["pdf"],
      tags: [],
      languages: [],
      lastModified: "2026-01-01",
    };
  });

  const embedder: Embedder = {
    async embedQuery() {
      return unit();
    },
    async embedPassages(texts) {
      return texts.map(unit);
    },
    async warmup() {},
    countTokens: (s) => Math.ceil(s.length / 4) + 2,
  };

  const deps = (store: SqliteIndexStore): ToolDeps => ({
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }),
    content: {
      getBook: async () => ({ ...book }),
      resolveLibraryId: async () => LIB,
    } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {
      getText: async (): Promise<ExtractedText> => ({
        text: TEXT,
        backend: "pdftotext",
        chars: TEXT.length,
        cached: true,
        markers: [],
        unplaced: 0,
        outline: [],
        epubToc: null,
      }),
    } satisfies Partial<ToolDeps["extractor"]>,
    figures: {} as ToolDeps["figures"],
    embedder,
    index: store,
    log,
  });

  const opts = (over: Partial<PrepareOptions> = {}): PrepareOptions => ({
    libraryId: LIB,
    library: undefined,
    force: false,
    keywordOnly: false,
    tokenBudgeted: true,
    ...over,
  });

  it("should_keep_the_metadata_vector_when_a_keyword_only_pass_meets_a_metadata_edit", async () => {
    const store = openStore();
    const d = deps(store);
    const first = await prepareBook(d, 7, opts());
    if (first.kind !== "ready") throw new Error(`expected ready, got ${first.kind}`);
    commitBook(d, LIB, first);
    book.lastModified = "2026-02-02";
    book.comments = "<p>Edited blurb.</p>";
    const again = await prepareBook(d, 7, opts({ keywordOnly: true, tokenBudgeted: false }));
    expect(again.kind).toBe("preserved");
    expect(counts(store).vectors).toBe(1);
  });
});
