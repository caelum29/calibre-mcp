// #605: a full index and the flags-only refresh store the same matter kinds for the same text,
// from one pure classifier; the refresh rewrites matter_kind.

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

const LIB = "Programming_Books";

// PDF pages split by \f: a contents page, four outline chapters, then an index and a copyright page.
const page = (s: string) => s.repeat(80);
// Long enough that the first chunk lies mostly before chapter 1, as a real contents page does.
const CONTENTS = [
  "Contents",
  ...Array.from({ length: 80 }, (_, i) => `Section ${i} of the book ........ ${2 + (i >> 3)}`),
].join("\n");
const chapter = (t: string) => [
  t + "\n" + page(`${t} explains one more idea in plain prose. `),
  page(`${t} goes on. `),
];
const INDEX = [
  "Index",
  ...Array.from({ length: 160 }, (_, i) => `term number ${i}, ${10 + i}, ${40 + i}`),
  "deploying things 289-292",
].join("\n");
// A full copyright page, longer than one chunk, so the last chunk holds copyright text only.
const COPYRIGHT = [
  "Copyright © 2026 Example Press. All rights reserved.",
  "ISBN 978-1-234-56789-0",
  "Printed in Romania.",
  "No part of this book may be reproduced without permission; all rights reserved. ".repeat(30),
].join("\n");
const TEXT = [
  CONTENTS,
  ...chapter("Getting Started"),
  ...chapter("Going Further"),
  ...chapter("Testing Things"),
  ...chapter("Deploying Things"),
  INDEX,
  COPYRIGHT,
].join("\f");
const OUTLINE: OutlineEntry[] = [
  { title: "Getting Started", page: 2, level: 1 },
  { title: "Going Further", page: 4, level: 1 },
  { title: "Testing Things", page: 6, level: 1 },
  { title: "Deploying Things", page: 8, level: 1 },
];

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

function deps(store: SqliteIndexStore, lastModified = "2026-01-01"): ToolDeps {
  const book: Book = {
    id: 1,
    uuid: "u-1",
    title: "Becoming Reliable",
    authors: ["Someone"],
    identifiers: {},
    formats: ["pdf"],
    tags: [],
    languages: [],
    lastModified,
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
        outline: OUTLINE,
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
const fresh = () => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
const kinds = (s: SqliteIndexStore) =>
  s.bookChunkSpans(LIB, 1).map((sp) => s.chunkAt(LIB, 1, sp.charStart)?.matterKind);

describe("matter kinds from a full index and from the flags-only refresh (#605)", () => {
  it("a full index labels the contents page front and the index and copyright pages back matter", async () => {
    const s = fresh();
    const p = await prepareBook(deps(s), 1, opts());
    if (p.kind !== "ready") throw new Error("setup");
    commitBook(deps(s), LIB, p);
    const k = kinds(s);
    expect([k[0], k.includes("back_index"), k.at(-1), k.includes("body")]).toEqual(["front", true, "back_other", true]);
  });

  it("the flags-only refresh writes exactly the kinds a full index writes for the same text", async () => {
    const full = fresh();
    const p = await prepareBook(deps(full), 1, opts());
    if (p.kind !== "ready") throw new Error("setup");
    commitBook(deps(full), LIB, p);

    // Same chunks stored with every kind wiped to body, then backfilled in place.
    const wiped = fresh();
    commitBook(deps(wiped), LIB, {
      ...p,
      chunks: p.chunks.map((c) => ({ ...c, matterKind: "body" as const })),
    });
    expect(kinds(wiped).every((k) => k === "body")).toBe(true);
    const r = await prepareBook(deps(wiped, "2026-02-01"), 1, opts({ flagsOnly: true }));
    if (r.kind !== "refreshed") throw new Error(`expected refreshed, got ${r.kind}`);
    commitRefresh(deps(wiped), LIB, r);

    expect(kinds(wiped)).toEqual(kinds(full));
    expect(wiped.chunkAt(LIB, 1, 0)?.matterKind).toBe("front");
  });
});
