// EPUB TOC drives the indexed front-matter boundary (#269): the authored TOC places chapter 1
// after a preface the text heuristics can't see, so the preface chunks must be flagged (and
// demoted by book-scope search). Flags also converge WITHOUT a re-embed: on a metadata-only
// refresh (#244), and via a flag-only backfill pass over already-fresh books.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { EpubToc } from "../../src/domain/structure/epub-toc.js";
import { inThreadEncoder, type BookEncoder, type EncodeJob } from "../../src/semantic/book-encoder.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { commitBook, commitRefresh, prepareBook, type PrepareOptions } from "../../src/app/index-book.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";
const PREFACE = "This preface explains why the book exists and who should read it. ".repeat(75);
const CH1 = "Getting Started\n\n" + "Install the toolchain and write the first program carefully. ".repeat(330);
const CH2 = "Going Further\n\n" + "Ownership rules make memory safety a compile time property. ".repeat(330);
const TEXT = PREFACE + CH1 + CH2;
/** Neither a heading nor a "Chapter N" line marks chapter 1 — only the TOC knows where it starts. */
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
const IN_PREFACE = 100;
const IN_BODY = PREFACE.length + CH1.length + 500;

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
  title?: string;
  lastModified?: string;
  text?: string;
  epubToc: EpubToc | null;
}

function deps(store: SqliteIndexStore, embedder: Embedder, ed: Edition): ToolDeps {
  const book: Book = {
    id: 1,
    uuid: "u-1",
    title: ed.title ?? "Becoming Reliable",
    authors: ["Someone"],
    identifiers: {},
    formats: ["epub"],
    tags: [],
    languages: [],
    lastModified: ed.lastModified ?? "2026-01-01",
  };
  const text = ed.text ?? TEXT;
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: { getBook: async () => book, resolveLibraryId: async () => LIB } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {
      getText: async (): Promise<ExtractedText> => ({
        text,
        backend: "ebook-convert",
        chars: text.length,
        cached: true,
        markers: [],
        unplaced: 0,
        outline: [],
        epubToc: ed.epubToc,
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

describe("EPUB TOC front-matter boundary in the index (#269)", () => {
  it("flags the preface chunks of an EPUB whose TOC places chapter 1 after it", async () => {
    const d = deps(freshStore(), countingEmbedder(), { epubToc: TOC });
    const p = await prepareBook(d, 1, opts());
    if (p.kind !== "ready") throw new Error(`expected ready, got ${p.kind}`);
    const flagged = p.chunks.filter((c) => c.frontMatter);
    expect(flagged.length).toBeGreaterThan(0);
    // Majority-overlap rule against the TOC boundary: every flagged chunk sits mostly in the preface.
    for (const c of p.chunks) {
      const inPreface = Math.min(c.charEnd, PREFACE.length) - c.charStart >= 0.5 * (c.charEnd - c.charStart);
      expect(c.frontMatter).toBe(inPreface);
    }
    expect(p.detail.frontMatterChunks).toBe(flagged.length);
  });

  it("flags nothing for the same text without a TOC (text heuristics find no chapter)", async () => {
    const p = await prepareBook(deps(freshStore(), countingEmbedder(), { epubToc: null }), 1, opts());
    if (p.kind !== "ready") throw new Error(`expected ready, got ${p.kind}`);
    expect(p.detail.frontMatterChunks).toBe(0);
  });

  it("hands the TOC to the encoder as structured-clone-safe data (worker-thread path)", async () => {
    let seen: EncodeJob | undefined;
    const emb = countingEmbedder();
    const capturing: BookEncoder = {
      encode(job, hooks) {
        seen = job;
        return inThreadEncoder(emb).encode(job, hooks);
      },
    };
    await prepareBook(deps(freshStore(), emb, { epubToc: TOC }), 1, opts({ encoder: capturing }));
    expect(seen?.epubToc).toEqual(TOC);
    expect(structuredClone(seen)).toEqual(seen);
  });

  it("backfills front-matter flags on a metadata-only refresh, without re-embedding", async () => {
    const store = freshStore();
    // Indexed before the TOC was available: no flags.
    await buildIndexTool.handler(buildArgs, deps(store, countingEmbedder(), { epubToc: null }));
    expect(flagAt(store, IN_PREFACE)).toBe(false);

    const second = countingEmbedder();
    const r = await buildIndexTool.handler(
      buildArgs,
      deps(store, second, { epubToc: TOC, title: "Becoming Reliable, 2nd Ed.", lastModified: "2026-02-01" }),
    );
    expect(r.structuredContent).toMatchObject({ booksRefreshed: 1, booksIndexed: 0 });
    expect(second.passages).toBe(0);
    expect(flagAt(store, IN_PREFACE)).toBe(true);
    expect(flagAt(store, IN_BODY)).toBe(false);
  });

  it("backfills flags on an already-fresh book in flagsOnly mode, without re-embedding", async () => {
    const store = freshStore();
    await buildIndexTool.handler(buildArgs, deps(store, countingEmbedder(), { epubToc: null }));
    const emb = countingEmbedder();
    const d = deps(store, emb, { epubToc: TOC }); // same last_modified: a normal build skips it

    const p = await prepareBook(d, 1, opts({ flagsOnly: true }));
    expect(p.kind).toBe("refreshed");
    if (p.kind !== "refreshed") return;
    commitRefresh(d, LIB, p);

    expect(emb.passages).toBe(0);
    expect(flagAt(store, IN_PREFACE)).toBe(true);
    expect(flagAt(store, IN_BODY)).toBe(false);
    expect(store.isBookIndexed(LIB, 1, "2026-01-01", { requireVectors: true })).toBe(true);
  });

  it("refuses a flagsOnly pass when the text changed, writing nothing", async () => {
    const store = freshStore();
    const first = deps(store, countingEmbedder(), { epubToc: null });
    const p0 = await prepareBook(first, 1, opts());
    if (p0.kind !== "ready") throw new Error("setup");
    commitBook(first, LIB, p0);

    const emb = countingEmbedder();
    const changed = deps(store, emb, { epubToc: TOC, text: TEXT.replace("first program", "first service") });
    await expect(prepareBook(changed, 1, opts({ flagsOnly: true }))).rejects.toThrow(/text changed/);
    expect(emb.passages).toBe(0);
    expect(flagAt(store, IN_PREFACE)).toBe(false);
  });

  it("refuses a flagsOnly pass for a book that is not indexed", async () => {
    const emb = countingEmbedder();
    await expect(prepareBook(deps(freshStore(), emb, { epubToc: TOC }), 1, opts({ flagsOnly: true }))).rejects.toThrow(
      /not indexed/,
    );
    expect(emb.passages).toBe(0);
  });
});
