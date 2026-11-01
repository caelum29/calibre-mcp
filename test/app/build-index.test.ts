// The index-build use case on its own (#346): selection, mode choice, tally, prune and cancel,
// asserted on the facts it returns — no ToolResult, no text rendering.

import { describe, expect, it } from "vitest";
import {
  runIndexBuild,
  type BuildIndexDeps,
  type BuildIndexOutcome,
  type BuildRequest,
  type BuildSummary,
} from "../../src/app/build-index.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import type { Book } from "../../src/domain/book.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import type { BuildProgress } from "../../src/semantic/index-builds.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import type { Reranker } from "../../src/semantic/reranker.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "../tools/fake-ports.js";

const LIB = "Programming_Books";

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

const TEXT: ExtractedText = {
  text: "Ownership and borrowing. ".repeat(200),
  backend: "pdftotext",
  chars: 5000,
  cached: false,
  markers: [],
  unplaced: 0,
  outline: [],
  epubToc: null,
};

const unit = (): Float32Array => {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return l2normalize(v);
};

function embedder(unavailable = false): Embedder & { warmups: number } {
  const fail = async (): Promise<never> => {
    throw new Error("EMBEDDER_UNAVAILABLE");
  };
  return {
    warmups: 0,
    async warmup() {
      this.warmups += 1;
      if (unavailable) await fail();
    },
    embedQuery: unavailable ? fail : async () => unit(),
    embedPassages: unavailable ? fail : async (texts) => texts.map(unit),
    countTokens: (s) => Math.ceil(s.length / 4) + 2,
  };
}

const failingReranker: Reranker = {
  async warmup() {
    throw new Error("download blocked");
  },
  async rerank() {
    throw new Error("rerank must not run during a build");
  },
};

interface Opts {
  libraryIds?: number[];
  embedder?: Embedder;
  reranker?: Reranker;
  getText?: () => Promise<ExtractedText>;
  store?: SqliteIndexStore;
}

function deps(o: Opts = {}): BuildIndexDeps {
  const ids = o.libraryIds ?? [1];
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: fakeContent({
      getBook: async (id) => book(id),
      resolveLibraryId: async () => asLibId(LIB),
      // honours num/offset like /ajax/search; uuid: queries match nothing
      search: async (p) => {
        const hits = p.query.startsWith("uuid:") ? [] : ids;
        const offset = p.offset ?? 0;
        const page = hits.slice(offset, offset + (p.num ?? 100));
        return { bookIds: page, total: hits.length, num: page.length, offset, sort: "", libraryId: LIB };
      },
    }),
    calibre: fakeCalibre(),
    extractor: fakeExtractor({ getText: o.getText ?? (async () => TEXT) }),
    figures: fakeFigures(),
    embedder: o.embedder ?? embedder(),
    ...(o.reranker ? { reranker: o.reranker } : {}),
    index: o.store ?? new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
}

const state = (): BuildProgress => ({ total: 0, done: 0, indexedIds: [], failures: [], selectedIds: [] });

/** The finished summary; any other outcome fails the test with its kind. */
function done(out: BuildIndexOutcome): BuildSummary {
  expect(out.kind).toBe("done");
  return (out as Extract<BuildIndexOutcome, { kind: "done" }>).summary;
}

const req = (over: Partial<BuildRequest>): BuildRequest => ({
  force: false,
  keywordOnly: false,
  prune: false,
  ...over,
});

describe("runIndexBuild (#346)", () => {
  it("reports no-targets with each unresolved selector, and an empty state", async () => {
    const s = state();
    const out = await runIndexBuild(deps(), req({ bookId: "nope-uuid", ids: ["gone-uuid"] }), LIB, s);
    expect(out).toEqual({ kind: "no-targets", failures: ["bookId nope-uuid: not found", "id gone-uuid: not found"] });
    expect(s.total).toBe(0);
    expect(s.selectedIds).toEqual([]);
  });

  it("indexes a selection with embeddings and fills the shared progress state", async () => {
    const s = state();
    const out = await runIndexBuild(deps({ libraryIds: [1, 2] }), req({ ids: [2, 1, 2] }), LIB, s);
    const sum = done(out);
    expect(sum).toMatchObject({
      booksRequested: 2,
      booksIndexed: 2,
      booksSkipped: 0,
      booksRefreshed: 0,
      booksPreserved: 0,
      failures: [],
      keywordOnly: false,
      rerankerWarmupFailed: false,
    });
    expect(sum.keywordOnlyReason).toBeUndefined();
    expect(sum.largeSelection).toBeUndefined();
    expect(sum.prune).toBeUndefined();
    // selection order (deduped), not completion order
    expect(sum.bookDetails.map((d) => d.bookId)).toEqual([2, 1]);
    expect(sum.chunks).toBe(sum.bookDetails.reduce((n, d) => n + d.chunks, 0));
    expect(sum.chunks).toBeGreaterThan(0);
    expect(s).toEqual({ total: 2, done: 2, indexedIds: [2, 1], failures: [], selectedIds: [2, 1] });
  });

  it("skips up-to-date books on a re-run of the same selection", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    await runIndexBuild(deps({ store }), req({ bookId: 1 }), LIB, state());
    const again = await runIndexBuild(deps({ store }), req({ bookId: 1 }), LIB, state());
    expect(done(again)).toMatchObject({ booksIndexed: 0, booksSkipped: 1, chunks: 0 });
  });

  it("names why the index is keyword-only: requested vs embedder unavailable", async () => {
    const asked = embedder();
    const requested = await runIndexBuild(
      deps({ embedder: asked }),
      req({ bookId: 1, keywordOnly: true }),
      LIB,
      state(),
    );
    expect(done(requested)).toMatchObject({
      keywordOnly: true,
      keywordOnlyReason: "requested",
      booksIndexed: 1,
    });
    expect(asked.warmups).toBe(0); // keywordOnly never probes the model

    const missing = embedder(true);
    const degraded = await runIndexBuild(deps({ embedder: missing }), req({ bookId: 1 }), LIB, state());
    expect(done(degraded)).toMatchObject({
      keywordOnly: true,
      keywordOnlyReason: "embedder-unavailable",
      booksIndexed: 1,
      failures: [],
    });
    expect(missing.warmups).toBe(1);
  });

  it("flags a failed reranker pre-download without failing the build", async () => {
    const out = await runIndexBuild(deps({ reranker: failingReranker }), req({ bookId: 1 }), LIB, state());
    expect(done(out)).toMatchObject({ rerankerWarmupFailed: true, booksIndexed: 1 });
  });

  it("selects every query match past one page and flags a large selection", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    const s = state();
    const out = await runIndexBuild(
      deps({ libraryIds: ids, getText: async () => Promise.reject(new Error("EXTRACT_FAILED")) }),
      req({ query: "tag:rust" }),
      LIB,
      s,
    );
    expect(done(out)).toMatchObject({ booksRequested: 101, booksIndexed: 0, largeSelection: 101 });
    expect(done(out).failures[0]).toBe("book 1: extraction failed");
    expect(done(out).failures).toHaveLength(101);
    expect(s.failures).toHaveLength(101);
    expect(s.done).toBe(101);
  });

  it("prunes index rows for books gone from the library", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    await runIndexBuild(deps({ store, libraryIds: [1, 2] }), req({ ids: [1, 2] }), LIB, state());
    const out = await runIndexBuild(deps({ store, libraryIds: [1] }), req({ bookId: 1, prune: true }), LIB, state());
    expect(done(out).prune).toMatchObject({ pruned: { books: 1 } });
    expect(store.indexedBookIds(LIB)).toEqual([1]);
  });

  it("refuses to prune against an empty library listing", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    await runIndexBuild(deps({ store }), req({ bookId: 1 }), LIB, state());
    const out = await runIndexBuild(deps({ store, libraryIds: [] }), req({ bookId: 1, prune: true }), LIB, state());
    expect(done(out).prune).toEqual({ skipped: "the library reported 0 books" });
    expect(store.indexedBookIds(LIB)).toEqual([1]);
  });

  it("returns cancelled counts when the signal is already aborted — no book counts as failed", async () => {
    const ac = new AbortController();
    ac.abort();
    const s = state();
    const out = await runIndexBuild(deps({ libraryIds: [1, 2] }), req({ ids: [1, 2] }), LIB, s, { signal: ac.signal });
    expect(out).toEqual({
      kind: "cancelled",
      counts: {
        booksRequested: 2,
        booksIndexed: 0,
        booksSkipped: 0,
        booksRefreshed: 0,
        booksPreserved: 0,
        failures: [],
        chunks: 0,
      },
    });
    expect(s.done).toBe(0);
    expect(s.failures).toEqual([]);
  });

  it("reports whole-book progress steps and hands each book a phase reporter", async () => {
    const sent: Array<[number, string, number | undefined]> = [];
    const phases: Array<[number, string]> = [];
    await runIndexBuild(deps({ libraryIds: [1, 2] }), req({ ids: [1, 2] }), LIB, state(), {
      progress: (v, m, t) => sent.push([v, m, t]),
      bookPhases: (_report, base, label) => {
        phases.push([base, label]);
        return { onPhase: () => {}, stop: () => {} };
      },
    });
    expect(phases).toEqual([
      [0, "Book 1/2 (id 1)"],
      [1, "Book 2/2 (id 2)"],
    ]);
    expect(sent).toEqual([
      [0, "Indexing 2 book(s)…", 2],
      [1, "Indexed 1/2 book(s)", 2],
      [2, "Indexed 2/2 book(s)", 2],
    ]);
  });
});
