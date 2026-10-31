// prepareBook/commitBook split (#99): prepare never writes, and the chunk+embed engine is a
// seam — a worker-thread encoder must produce the same index rows as the in-thread one.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import { inThreadEncoder, type BookEncoder } from "../../src/semantic/book-encoder.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { commitBook, isDbBusy, prepareBook, withBusyRetry, type PreparedBook } from "../../src/tools/index-book.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";
const book: Book = {
  id: 7,
  uuid: "u-7",
  title: "Rust in Action",
  authors: ["Tim"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
};

const embedder: Embedder = {
  async embedQuery() {
    return new Float32Array(EMBED_DIM);
  },
  async embedPassages(texts) {
    return texts.map((t) => {
      const v = new Float32Array(EMBED_DIM);
      v[t.length % EMBED_DIM] = 1;
      return l2normalize(v);
    });
  },
  async warmup() {},
  countTokens: (s) => Math.ceil(s.length / 4) + 2,
};

function deps(store: SqliteIndexStore): ToolDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: { getBook: async () => book } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    // no markers are placed, so the figure inventory is never consulted
    figures: {} as ToolDeps["figures"],
    extractor: {
      getText: async (): Promise<ExtractedText> => ({
        text: "Ownership and borrowing. ".repeat(300),
        backend: "pdftotext",
        chars: 7500,
        cached: false,
        markers: [],
        unplaced: 0,
        outline: [],
        epubToc: null,
      }),
    } satisfies Partial<ToolDeps["extractor"]> as ToolDeps["extractor"],
    embedder,
    index: store,
    log,
  };
}

const opts = { libraryId: LIB, library: undefined, force: false, keywordOnly: false, tokenBudgeted: true };

describe("prepareBook / commitBook", () => {
  it("prepare writes nothing; commit persists the prepared rows", async () => {
    const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    const d = deps(store);
    const prepared = (await prepareBook(d, 7, opts)) as PreparedBook;
    expect(prepared.kind).toBe("ready");
    expect(store.isBookIndexed(LIB, 7)).toBe(false);
    commitBook(d, LIB, prepared);
    expect(store.isBookIndexed(LIB, 7)).toBe(true);
  });

  it("a delegated encoder (as a worker thread would be) yields the same rows as in-thread", async () => {
    const d = deps(new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })));
    const jobs: string[] = [];
    const inner = inThreadEncoder(embedder);
    // Stand-in for ThreadEncoder: the job crosses a structured-clone boundary both ways.
    const delegated: BookEncoder = {
      async encode(job) {
        jobs.push(job.ctx);
        return structuredClone(await inner.encode(structuredClone(job)));
      },
    };
    const a = (await prepareBook(d, 7, opts)) as PreparedBook;
    const b = (await prepareBook(d, 7, { ...opts, encoder: delegated })) as PreparedBook;
    expect(jobs).toEqual(["[Rust in Action › Tim]\n"]);
    expect(b.chunks).toEqual(a.chunks);
    expect(b.detail).toEqual(a.detail);
  });

  it("an encoder failure fails only that book's prepare, with the coded message intact", async () => {
    const d = deps(new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })));
    const broken: BookEncoder = {
      encode: async () => {
        throw new Error("EMBEDDER_UNAVAILABLE");
      },
    };
    await expect(prepareBook(d, 7, { ...opts, encoder: broken })).rejects.toThrow("EMBEDDER_UNAVAILABLE");
  });
});

describe("withBusyRetry (#196)", () => {
  // node:sqlite surfaces SQLITE_BUSY as an Error carrying errcode 5.
  const busy = () => Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5 });

  it("recognizes busy/locked sqlite errors only", () => {
    expect(isDbBusy(busy())).toBe(true);
    expect(isDbBusy(Object.assign(new Error("x"), { errcode: 517 }))).toBe(true); // SQLITE_BUSY_SNAPSHOT
    expect(isDbBusy(new Error("database table is locked"))).toBe(true);
    expect(isDbBusy(new Error("EXTRACT_FAILED"))).toBe(false);
    expect(isDbBusy(Object.assign(new Error("constraint"), { errcode: 19 }))).toBe(false);
  });

  it("retries a busy commit once, then succeeds", async () => {
    let calls = 0;
    const out = await withBusyRetry(() => {
      if (++calls === 1) throw busy();
      return "ok";
    }, 1);
    expect(out).toBe("ok");
    expect(calls).toBe(2);
  });

  it("gives up after the second busy, and never retries other errors", async () => {
    let calls = 0;
    await expect(
      withBusyRetry(() => {
        calls++;
        throw busy();
      }, 1),
    ).rejects.toThrow(/locked/);
    expect(calls).toBe(2);
    calls = 0;
    await expect(
      withBusyRetry(() => {
        calls++;
        throw new Error("EXTRACT_FAILED");
      }, 1),
    ).rejects.toThrow("EXTRACT_FAILED");
    expect(calls).toBe(1);
  });
});
