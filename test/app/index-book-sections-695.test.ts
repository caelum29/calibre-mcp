// #695 wiring: the index trip stores a book's section spans in the same pass as its chunks,
// from the same text, and the flag-only refresh (#269) fills them for an already-indexed book
// without re-embedding — the backfill path for live libraries.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { OutlineEntry } from "../../src/domain/structure/pdf-outline.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { commitBook, commitRefresh, prepareBook, type PrepareOptions } from "../../src/app/index-book.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Humanities";

const page = (s: string) => s.repeat(40);
const chapter = (t: string) => [
  t + "\n" + page(`${t} explains one more idea in plain prose. `),
  page(`${t} goes on. `),
];
const PAGES = [
  page("This preface explains why the book exists and who reads it. "),
  ...chapter("Getting Started"),
  ...chapter("Going Further"),
  ...chapter("Testing Things"),
];
const TEXT = PAGES.join("\f");
const OUTLINE: OutlineEntry[] = [
  { title: "Preface", page: 1, level: 1 },
  { title: "Getting Started", page: 2, level: 1 },
  { title: "Going Further", page: 4, level: 1 },
  { title: "Testing Things", page: 6, level: 1 },
];

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

function deps(store: SqliteIndexStore, embedder: Embedder, outline: OutlineEntry[]): ToolDeps {
  const book: Book = {
    id: 1,
    uuid: "u-1",
    title: "Becoming Reliable",
    authors: ["Someone"],
    identifiers: {},
    formats: ["pdf"],
    tags: [],
    languages: [],
    lastModified: "2026-01-01",
  };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: { getBook: async () => book, resolveLibraryId: async () => LIB } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {
      getText: async (): Promise<ExtractedText> => ({
        text: TEXT,
        backend: "pdftotext",
        chars: TEXT.length,
        cached: true,
        markers: [],
        unplaced: 0,
        outline,
        epubToc: null,
      }),
    } satisfies Partial<ToolDeps["extractor"]> as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder,
    index: store,
    log,
  };
}

const freshStore = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
const opts = (over: Partial<PrepareOptions> = {}): PrepareOptions => ({
  libraryId: LIB,
  library: undefined,
  force: false,
  keywordOnly: false,
  tokenBudgeted: true,
  ...over,
});
const further = TEXT.indexOf("Going Further\n");

async function indexOnce(store: SqliteIndexStore, outline: OutlineEntry[]): Promise<void> {
  const d = deps(store, countingEmbedder(), outline);
  const p = await prepareBook(d, 1, opts());
  if (p.kind !== "ready") throw new Error(`expected ready, got ${p.kind}`);
  commitBook(d, LIB, p);
}

describe("section spans in the index trip (#695)", () => {
  it("a full index stores the outline spans with the chunks", async () => {
    const store = freshStore();
    await indexOnce(store, OUTLINE);
    expect(store.sectionPathAt(LIB, 1, further + 50)).toEqual([
      expect.objectContaining({ title: "Going Further", level: 1, charStart: further, source: "pdf-outline" }),
    ]);
  });

  it("spans share the chunks' coordinates: the chunk at a span start holds its heading", async () => {
    const store = freshStore();
    await indexOnce(store, OUTLINE);
    const start = store.sectionPathAt(LIB, 1, further + 50)[0]!.charStart;
    const c = store.chunkAt(LIB, 1, start)!;
    expect(TEXT.slice(start, c.charEnd).startsWith("Going Further\n")).toBe(true);
  });

  it("the preface row carries the chunks' front kind", async () => {
    const store = freshStore();
    await indexOnce(store, OUTLINE);
    expect(store.sectionPathAt(LIB, 1, 10).map((s) => [s.title, s.matterKind])).toEqual([["Preface", "front"]]);
  });

  it("the flag-only refresh fills spans for an indexed book without re-embedding", async () => {
    const store = freshStore();
    await indexOnce(store, []); // indexed before the outline was usable: no spans
    const before = store.sectionPathAt(LIB, 1, further + 50);
    const embedder = countingEmbedder();
    const d = deps(store, embedder, OUTLINE);
    const r = await prepareBook(d, 1, opts({ flagsOnly: true }));
    if (r.kind !== "refreshed") throw new Error(`expected refreshed, got ${r.kind}`);
    commitRefresh(d, LIB, r);
    expect([before, store.sectionPathAt(LIB, 1, further + 50).map((s) => s.title), embedder.passages]).toEqual([
      [],
      ["Going Further"],
      0,
    ]);
  });
});
