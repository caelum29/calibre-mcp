// #631 index side: every indexed book gets one metadata row (own table + own FTS index, never a
// chunks row), written in the book's transaction, re-embedded alone on a metadata edit, and
// deleted with the book. Read straight from the index file: nothing reads it at query time yet.

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
import { commitBook, commitRefresh, prepareBook, type PrepareOptions } from "../../src/app/index-book.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";
const TEXT = "Closures capture variables from the enclosing scope. ".repeat(60);
const META_TEXT =
  "Professional JavaScript for Web Developers\nMatt Frisbie\nJavaScript, Web\n\nThe DOM, events and browser APIs.";

function recordingEmbedder(): Embedder & { texts: string[] } {
  return {
    texts: [],
    async embedQuery() {
      return new Float32Array(EMBED_DIM);
    },
    async embedPassages(texts) {
      this.texts.push(...texts);
      return texts.map(() => {
        const v = new Float32Array(EMBED_DIM);
        v[1] = 1;
        return v;
      });
    },
    async warmup() {},
    countTokens: (s) => Math.ceil(s.length / 4) + 2,
  };
}

let dir: string;
let book: Book;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-meta-631-"));
  book = {
    id: 247,
    uuid: "u-247",
    title: "Professional JavaScript for Web Developers",
    authors: ["Matt Frisbie"],
    comments: "<p>The DOM, events and browser APIs.</p>",
    identifiers: {},
    formats: ["pdf"],
    tags: ["JavaScript", "Web"],
    languages: [],
    lastModified: "2026-01-01",
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const openStore = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));

function deps(store: SqliteIndexStore, embedder: Embedder): ToolDeps {
  return {
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
    } satisfies Partial<ToolDeps["extractor"]> as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder,
    index: store,
    log,
  };
}

const opts = (over: Partial<PrepareOptions> = {}): PrepareOptions => ({
  libraryId: LIB,
  library: undefined,
  force: false,
  keywordOnly: false,
  tokenBudgeted: true,
  ...over,
});

async function indexOnce(store: SqliteIndexStore, embedder: Embedder, over: Partial<PrepareOptions> = {}) {
  const d = deps(store, embedder);
  const p = await prepareBook(d, 247, opts(over));
  if (p.kind !== "ready") throw new Error(`expected ready, got ${p.kind}`);
  commitBook(d, LIB, p);
}

/** Raw rows of the metadata table, read from the closed index file. */
function rows(store: SqliteIndexStore, ftsQuery?: string) {
  store.close();
  const db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`), { readOnly: true });
  try {
    const meta = db
      .prepare(
        "SELECT book_id, body, body_stem <> '' AS stemmed, blurb_chars, last_modified, vector IS NOT NULL AS has_vector FROM book_metadata ORDER BY book_id",
      )
      .all()
      .map((r) => ({ ...r }));
    const fts = ftsQuery
      ? db
          .prepare("SELECT rowid AS book_id FROM book_metadata_fts WHERE book_metadata_fts MATCH ?")
          .all(ftsQuery)
          .map((r) => Number(r.book_id))
      : [];
    const chunks = Number((db.prepare("SELECT count(*) AS n FROM chunks").get() as { n: number }).n);
    const vectors = Number((db.prepare("SELECT count(*) AS n FROM embeddings").get() as { n: number }).n);
    return { meta, fts, chunks, vectors };
  } finally {
    db.close();
  }
}

describe("per-book metadata row in the index trip (#631)", () => {
  it("a full index writes one row: the text, its stems, its passage vector and last_modified", async () => {
    const store = openStore();
    const embedder = recordingEmbedder();
    await indexOnce(store, embedder);
    expect(embedder.texts.filter((t) => t === META_TEXT)).toHaveLength(1);
    expect(rows(store).meta).toEqual([
      { book_id: 247, body: META_TEXT, stemmed: 1, blurb_chars: 33, last_modified: "2026-01-01", has_vector: 1 },
    ]);
  });

  it("the row is never a chunk: chunks and embeddings hold the body text only", async () => {
    const store = openStore();
    const embedder = recordingEmbedder();
    await indexOnce(store, embedder);
    const bodyTexts = embedder.texts.filter((t) => t !== META_TEXT).length;
    const r = rows(store);
    expect([r.chunks, r.vectors]).toEqual([bodyTexts, bodyTexts]);
  });

  it("the row is keyword-indexed in its own FTS table (stemmed and raw)", async () => {
    const store = openStore();
    await indexOnce(store, recordingEmbedder());
    expect(rows(store, "body:frisbie AND body:browser").fts).toEqual([247]);
  });

  it("a book with no blurb still gets a row", async () => {
    book.comments = undefined;
    book.tags = [];
    const store = openStore();
    await indexOnce(store, recordingEmbedder());
    expect(rows(store).meta).toEqual([
      expect.objectContaining({
        book_id: 247,
        body: "Professional JavaScript for Web Developers\nMatt Frisbie",
        blurb_chars: 0,
      }),
    ]);
  });

  it("a keyword-only build stores the row without a vector", async () => {
    const store = openStore();
    await indexOnce(store, recordingEmbedder(), { keywordOnly: true, tokenBudgeted: false });
    expect(rows(store).meta).toEqual([expect.objectContaining({ book_id: 247, has_vector: 0, stemmed: 1 })]);
  });

  it("a metadata edit re-embeds only the metadata row: one passage, chunks kept", async () => {
    const store = openStore();
    await indexOnce(store, recordingEmbedder());
    book.lastModified = "2026-02-02";
    book.comments = "<p>New blurb about promises.</p>";
    const embedder = recordingEmbedder();
    const d = deps(store, embedder);
    const r = await prepareBook(d, 247, opts());
    if (r.kind !== "refreshed") throw new Error(`expected refreshed, got ${r.kind}`);
    commitRefresh(d, LIB, r);
    const edited =
      "Professional JavaScript for Web Developers\nMatt Frisbie\nJavaScript, Web\n\nNew blurb about promises.";
    expect(embedder.texts).toEqual([edited]);
    expect(rows(store).meta).toEqual([
      { book_id: 247, body: edited, stemmed: 1, blurb_chars: 25, last_modified: "2026-02-02", has_vector: 1 },
    ]);
  });

  it("the flag-only backfill embeds nothing and leaves the row as it was", async () => {
    const store = openStore();
    await indexOnce(store, recordingEmbedder());
    book.comments = "<p>Changed but not re-embedded.</p>";
    const embedder = recordingEmbedder();
    const d = deps(store, embedder);
    const r = await prepareBook(d, 247, opts({ flagsOnly: true }));
    if (r.kind !== "refreshed") throw new Error(`expected refreshed, got ${r.kind}`);
    commitRefresh(d, LIB, r);
    expect([embedder.texts.length, rows(store).meta.map((m) => m.body)]).toEqual([0, [META_TEXT]]);
  });

  it("deleting the book deletes its row and its FTS entry", async () => {
    const store = openStore();
    await indexOnce(store, recordingEmbedder());
    store.deleteBooks(LIB, [247]);
    const r = rows(store, "frisbie");
    expect([r.meta, r.fts]).toEqual([[], []]);
  });

  it("re-indexing the book replaces its row instead of adding one", async () => {
    const store = openStore();
    await indexOnce(store, recordingEmbedder());
    await indexOnce(store, recordingEmbedder(), { force: true });
    expect(rows(store, "frisbie")).toEqual(
      expect.objectContaining({ fts: [247], meta: [expect.objectContaining({ book_id: 247 })] }),
    );
  });
});
