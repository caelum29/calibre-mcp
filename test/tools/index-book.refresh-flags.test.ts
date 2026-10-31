// In-place refresh hardening (#269 review): any metadata-only refresh — PDF too, not just
// EPUB — re-derives front-matter flags for an already-indexed book; and a refresh whose book
// was re-chunked by another writer between prepare and commit writes nothing.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { EpubToc } from "../../src/domain/structure/epub-toc.js";
import type { OutlineEntry } from "../../src/domain/structure/pdf-outline.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { commitBook, commitRefresh, prepareBook, type PrepareOptions } from "../../src/tools/index-book.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";

// PDF: one preface page, then four outline chapters (two pages each), pages split by \f.
const page = (s: string) => s.repeat(40);
const chapter = (t: string) => [
  t + "\n" + page(`${t} explains one more idea in plain prose. `),
  page(`${t} continues. `),
];
const PDF_PAGES = [
  page("This preface explains why the book exists and who reads it. "),
  ...chapter("Getting Started"),
  ...chapter("Going Further"),
  ...chapter("Testing Things"),
  ...chapter("Deploying Things"),
];
const PDF_TEXT = PDF_PAGES.join("\f");
const OUTLINE: OutlineEntry[] = [
  { title: "Preface", page: 1, level: 1 },
  { title: "Getting Started", page: 2, level: 1 },
  { title: "Going Further", page: 4, level: 1 },
  { title: "Testing Things", page: 6, level: 1 },
  { title: "Deploying Things", page: 8, level: 1 },
];

// EPUB: a heading-less preface only the TOC can place.
const PREFACE = "This preface explains why the book exists and who should read it. ".repeat(75);
const CH1 = "Getting Started\n\n" + "Install the toolchain and write the first program carefully. ".repeat(330);
const CH2 = "Going Further\n\n" + "Ownership rules make memory safety a compile time property. ".repeat(330);
const EPUB_TEXT = PREFACE + CH1 + CH2;
const TOC: EpubToc = {
  entries: [
    { title: "Preface", level: 1, href: "pre.xhtml" },
    { title: "Getting Started", level: 1, href: "ch1.xhtml" },
    { title: "Going Further", level: 1, href: "ch2.xhtml" },
  ],
  anchors: [
    { href: "pre.xhtml", start: 0 },
    { href: "ch1.xhtml", start: PREFACE.length },
    { href: "ch2.xhtml", start: PREFACE.length + CH1.length },
  ],
};

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
  format: "pdf" | "epub";
  text: string;
  title?: string;
  lastModified?: string;
  outline?: OutlineEntry[];
  epubToc?: EpubToc | null;
}

function deps(store: SqliteIndexStore, embedder: Embedder, ed: Edition): ToolDeps {
  const book: Book = {
    id: 1,
    uuid: "u-1",
    title: ed.title ?? "Becoming Reliable",
    authors: ["Someone"],
    identifiers: {},
    formats: [ed.format],
    tags: [],
    languages: [],
    lastModified: ed.lastModified ?? "2026-01-01",
  };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: { getBook: async () => book, resolveLibraryId: async () => LIB } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {
      getText: async (): Promise<ExtractedText> => ({
        text: ed.text,
        backend: ed.format === "pdf" ? "pdftotext" : "ebook-convert",
        chars: ed.text.length,
        cached: true,
        markers: [],
        unplaced: 0,
        outline: ed.outline ?? [],
        epubToc: ed.epubToc ?? null,
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
const buildArgs = { bookId: 1, force: false, enableFts: false, keywordOnly: false, prune: false };
const flagAt = (store: SqliteIndexStore, offset: number) => store.chunkAt(LIB, 1, offset)?.frontMatter;
const title = (store: SqliteIndexStore) =>
  store.searchLibraryFts(LIB, "zanzibar", 10).length > 0 ? "zanzibar" : "other";

describe("in-place refresh of front-matter flags (#269 review)", () => {
  it("re-derives a PDF's flags from its outline on a metadata-only refresh, without re-embedding", async () => {
    const store = freshStore();
    // Indexed without a usable outline: no front matter.
    await buildIndexTool.handler(buildArgs, deps(store, countingEmbedder(), { format: "pdf", text: PDF_TEXT }));
    expect(flagAt(store, 100)).toBe(false);

    const second = countingEmbedder();
    const r = await buildIndexTool.handler(
      buildArgs,
      deps(store, second, {
        format: "pdf",
        text: PDF_TEXT,
        outline: OUTLINE,
        title: "Retitled",
        lastModified: "2026-02-01",
      }),
    );
    expect(r.structuredContent).toMatchObject({ booksRefreshed: 1, booksIndexed: 0 });
    expect(second.passages).toBe(0);
    expect(flagAt(store, 100)).toBe(true);
    expect(flagAt(store, PDF_TEXT.length - 100)).toBe(false);
  });

  it("writes nothing when another writer re-chunked the book between prepare and commit", async () => {
    const store = freshStore();
    const original = deps(store, countingEmbedder(), { format: "epub", text: EPUB_TEXT });
    const p0 = await prepareBook(original, 1, opts());
    if (p0.kind !== "ready") throw new Error("setup");
    commitBook(original, LIB, p0);

    // Backfill prepares against the original chunks…
    const backfill = deps(store, countingEmbedder(), {
      format: "epub",
      text: EPUB_TEXT,
      epubToc: TOC,
      title: "Zanzibar",
    });
    const refreshed = await prepareBook(backfill, 1, opts({ flagsOnly: true }));
    if (refreshed.kind !== "refreshed") throw new Error(`expected refreshed, got ${refreshed.kind}`);

    // …while a live build re-indexes the book with a new text (different chunk spans).
    const newText = "Errata and a new introduction, inserted ahead of everything. ".repeat(60) + EPUB_TEXT;
    const live = deps(store, countingEmbedder(), { format: "epub", text: newText, lastModified: "2026-03-01" });
    const p1 = await prepareBook(live, 1, opts({ force: true }));
    if (p1.kind !== "ready") throw new Error("setup");
    commitBook(live, LIB, p1);
    const spansAfterLive = store.bookChunkSpans(LIB, 1);

    expect(() => commitRefresh(backfill, LIB, refreshed)).toThrow(/re-indexed during the refresh/);
    // The live writer's rows stand untouched: spans, flags (no TOC → none), title, freshness.
    expect(store.bookChunkSpans(LIB, 1)).toEqual(spansAfterLive);
    expect(flagAt(store, 100)).toBe(false);
    expect(title(store)).toBe("other");
    expect(store.isBookIndexed(LIB, 1, "2026-03-01")).toBe(true);
  });

  it("store: refreshBookMeta with stale spans returns false and leaves the row alone", async () => {
    const store = freshStore();
    const d = deps(store, countingEmbedder(), { format: "epub", text: EPUB_TEXT });
    const p = await prepareBook(d, 1, opts());
    if (p.kind !== "ready") throw new Error("setup");
    commitBook(d, LIB, p);
    const spans = store.bookChunkSpans(LIB, 1);
    const stale = spans.slice(1);
    const meta = { bookId: 1, title: "Zanzibar", authors: ["X"], lastModified: "2026-05-05" };

    expect(store.refreshBookMeta(LIB, meta, { frontMatterEnd: PREFACE.length, spans: stale })).toBe(false);
    expect(title(store)).toBe("other");
    expect(flagAt(store, 100)).toBe(false);

    expect(store.refreshBookMeta(LIB, meta, { frontMatterEnd: PREFACE.length, spans })).toBe(true);
    expect(title(store)).toBe("zanzibar");
    expect(flagAt(store, 100)).toBe(true);
  });
});
