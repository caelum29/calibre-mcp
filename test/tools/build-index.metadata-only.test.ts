// Metadata-only edits must not re-embed (#244): Calibre bumps last_modified on ANY metadata
// change, so a retitled book used to re-extract AND re-embed its unchanged text. Now an
// unchanged text refreshes title/authors in place (books row, chunk + figure book_meta, FTS)
// and keeps the vectors; a content change, force, or a vector-less entry still re-embeds.

import { describe, expect, it } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { FigureMarker } from "../../src/domain/figures/markers.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { stemText } from "../../src/semantic/stem.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";
const BODY = "Ownership and borrowing keep memory safe without a garbage collector. ".repeat(300);
const CAPTION = "Figure 1. The borrow checker at work";

/** Embedder that counts every passage it embeds. */
function countingEmbedder(): Embedder & { passages: number } {
  return {
    passages: 0,
    async embedQuery() {
      return new Float32Array(EMBED_DIM);
    },
    async embedPassages(texts) {
      this.passages += texts.length;
      return texts.map(() => {
        const v = new Float32Array(EMBED_DIM);
        v[0] = 1;
        return v;
      });
    },
    async warmup() {},
    countTokens: (s) => Math.ceil(s.length / 4) + 2,
  };
}

interface Edition {
  title: string;
  authors: string[];
  lastModified: string;
  text?: string;
  markers?: FigureMarker[];
}

function deps(store: SqliteIndexStore, embedder: Embedder, ed: Edition): ToolDeps {
  const book: Book = {
    id: 1,
    uuid: "u-1",
    title: ed.title,
    authors: ed.authors,
    identifiers: {},
    formats: ["pdf"],
    tags: [],
    languages: [],
    lastModified: ed.lastModified,
  };
  const text = ed.text ?? BODY;
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: {
      getBook: async () => book,
      resolveLibraryId: async () => LIB,
    } as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: {
      getText: async (): Promise<ExtractedText> => ({
        text,
        backend: "pdftotext",
        chars: text.length,
        cached: false,
        markers: ed.markers ?? [],
        unplaced: 0,
        outline: [],
        epubToc: null,
      }),
    } satisfies Partial<ToolDeps["extractor"]> as ToolDeps["extractor"],
    figures: { getInventory: async () => ({ inventory: { entries: [] } }) } as unknown as ToolDeps["figures"],
    embedder,
    index: store,
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

const original: Edition = { title: "Quokka Handbook", authors: ["Ann Old"], lastModified: "2026-01-01" };
const retitled: Edition = { title: "Zanzibar Handbook", authors: ["Bob New"], lastModified: "2026-02-01" };

const ftsBooks = (store: SqliteIndexStore, word: string) =>
  store.searchLibraryFts(LIB, stemText(word), 10).map((h) => h.bookId);

function freshStore(): SqliteIndexStore {
  return new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
}

describe("calibre_build_index metadata-only edits (#244)", () => {
  it("refreshes title/authors in place without re-embedding when the text is unchanged", async () => {
    const store = freshStore();
    await buildIndexTool.handler(args(), deps(store, countingEmbedder(), original));
    const chunksBefore = store.stats(LIB).chunks;
    const vectorsBefore = store.vectorCount(LIB);

    const second = countingEmbedder();
    const r = await buildIndexTool.handler(args(), deps(store, second, retitled));

    expect(r.isError).toBeFalsy();
    expect(second.passages).toBe(0);
    expect(r.structuredContent).toMatchObject({
      booksRequested: 1,
      booksIndexed: 0,
      booksSkipped: 0,
      booksRefreshed: 1,
    });
    expect((r.content[0] as { text: string }).text).toContain("1 metadata-only");
    // Fresh under the NEW last_modified, vectors intact — the next build skips it.
    expect(store.isBookIndexed(LIB, 1, "2026-02-01", { requireVectors: true })).toBe(true);
    expect(store.stats(LIB).chunks).toBe(chunksBefore);
    expect(store.vectorCount(LIB)).toBe(vectorsBefore);
    // FTS book_meta follows the new title and authors; the old ones no longer match.
    expect(ftsBooks(store, "Zanzibar")).toEqual([1]);
    expect(ftsBooks(store, "Bob")).toEqual([1]);
    expect(ftsBooks(store, "Quokka")).toEqual([]);

    const third = countingEmbedder();
    const again = await buildIndexTool.handler(args(), deps(store, third, retitled));
    expect(again.structuredContent).toMatchObject({ booksSkipped: 1, booksRefreshed: 0 });
  });

  it("refreshes figure captions' book_meta in place too", async () => {
    const store = freshStore();
    const markers: FigureMarker[] = [{ index: 0, charOffset: 100, page: 1, caption: CAPTION }];
    await buildIndexTool.handler(args(), deps(store, countingEmbedder(), { ...original, markers }));
    const second = countingEmbedder();
    await buildIndexTool.handler(args(), deps(store, second, { ...retitled, markers }));

    expect(second.passages).toBe(0);
    expect(store.figureCount(LIB, 1)).toBe(1);
    expect(store.searchFiguresFts(LIB, stemText("Zanzibar"), 10).map((h) => h.bookId)).toEqual([1]);
    expect(store.searchFiguresFts(LIB, stemText("Quokka"), 10)).toEqual([]);
  });

  it("re-embeds when the text changed along with last_modified", async () => {
    const store = freshStore();
    await buildIndexTool.handler(args(), deps(store, countingEmbedder(), original));
    const second = countingEmbedder();
    const r = await buildIndexTool.handler(
      args(),
      deps(store, second, { ...retitled, text: BODY.replace("garbage collector", "tracing collector") }),
    );
    expect(second.passages).toBeGreaterThan(0);
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, booksRefreshed: 0 });
  });

  it("re-embeds when text was only appended after the indexed span", async () => {
    const store = freshStore();
    await buildIndexTool.handler(args(), deps(store, countingEmbedder(), original));
    const second = countingEmbedder();
    const r = await buildIndexTool.handler(
      args(),
      deps(store, second, { ...retitled, text: BODY + "An appendix on lifetimes." }),
    );
    expect(second.passages).toBeGreaterThan(0);
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, booksRefreshed: 0 });
  });

  it("re-embeds an unchanged book when force is set", async () => {
    const store = freshStore();
    await buildIndexTool.handler(args(), deps(store, countingEmbedder(), original));
    const second = countingEmbedder();
    const r = await buildIndexTool.handler(args({ force: true }), deps(store, second, retitled));
    expect(second.passages).toBeGreaterThan(0);
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, booksRefreshed: 0 });
  });

  it("re-embeds a keyword-only entry on a semantic build even when the text is unchanged", async () => {
    const store = freshStore();
    await buildIndexTool.handler(args({ keywordOnly: true }), deps(store, countingEmbedder(), original));
    const second = countingEmbedder();
    const r = await buildIndexTool.handler(args(), deps(store, second, retitled));
    expect(second.passages).toBeGreaterThan(0);
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1, booksRefreshed: 0 });
    expect(store.isBookIndexed(LIB, 1, "2026-02-01", { requireVectors: true })).toBe(true);
  });
});
