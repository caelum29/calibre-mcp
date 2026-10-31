// Sub-book progress for calibre_build_index (#245): one large book must keep emitting
// notifications/progress while it is extracted and embedded, so clients that reset their
// request timeout on progress keep the call alive. Runs the real throttled reporter on a
// fake clock; the fake embedder costs fake time per passage, like the real model.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { createProgressReporter, type ProgressNotification } from "../../src/progress.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
import { l2normalize } from "../../src/semantic/vector.js";
import type { ToolDeps } from "../../src/tools/deps.js";

/** Fake model cost per embedded passage — a 100+ chunk book takes many throttle windows. */
const MS_PER_PASSAGE = 50;
/** The reporter's default throttle window (src/progress.ts). */
const THROTTLE_MS = 100;

const tick = (ms: number) => vi.setSystemTime(Date.now() + ms);

const book = (id: number): Book => ({
  id,
  uuid: `u-${id}`,
  title: "Big Print PDF",
  authors: ["Someone"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
});

/** Embedder whose wall time scales with the passages it is handed. */
const slowEmbedder: Embedder = {
  async embedQuery() {
    return new Float32Array(EMBED_DIM);
  },
  async embedPassages(texts) {
    tick(texts.length * MS_PER_PASSAGE);
    return texts.map(() => {
      const v = new Float32Array(EMBED_DIM);
      v[0] = 1;
      return l2normalize(v);
    });
  },
  async warmup() {},
  countTokens: (s) => Math.ceil(s.length / 4) + 2,
};

function deps(): ToolDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: {
      // metadata fetch and extraction each take fake time, so their phases are observable
      getBook: async (id: number) => {
        tick(150);
        return book(id);
      },
      resolveLibraryId: async () => "Programming_Books",
    } as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: {
      getText: async (): Promise<ExtractedText> => {
        tick(500);
        const text = "Ownership and borrowing in systems programming. ".repeat(6000);
        return {
          text,
          backend: "pdftotext",
          chars: text.length,
          cached: false,
          markers: [],
          unplaced: 0,
          outline: [],
          epubToc: null,
        };
      },
    } as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: slowEmbedder,
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
}

type Sent = ProgressNotification & { at: number };

/** The handler ctx exactly as server.ts builds it: a real throttled reporter. */
function progressCtx(sent: Sent[]) {
  return {
    signal: new AbortController().signal,
    progress: createProgressReporter({
      progressToken: "tok",
      send: async (p) => {
        sent.push({ ...p, at: Date.now() });
      },
    }),
  };
}

const args = (over: Record<string, unknown>) => ({
  force: false,
  enableFts: false,
  keywordOnly: false,
  prune: false,
  ...over,
});

const EMBED_MSG = /embedding (\d+)\/(\d+) chunks/;

describe("calibre_build_index sub-book progress (#245)", () => {
  beforeEach(() => {
    // Only Date is faked: the chunker's setImmediate yields must still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports extract and embed progress DURING a single book, throttled, with the book-level contract intact", async () => {
    const sent: Sent[] = [];
    const r = await buildIndexTool.handler(args({ bookId: 1 }), deps(), progressCtx(sent));
    expect(r.isError).toBeFalsy();
    const chunks = r.structuredContent?.chunks as number;
    expect(chunks).toBeGreaterThan(100);

    // Book-level contract unchanged: starts at 0 and completes at total with the same messages.
    expect(sent[0]).toMatchObject({ progress: 0, total: 1, message: "Indexing 1 book(s)…" });
    expect(sent.at(-1)).toMatchObject({ progress: 1, total: 1, message: "Indexed 1/1 book(s)" });

    // Mid-book notifications: fractional progress strictly inside the one book.
    const mid = sent.filter((p) => p.progress > 0 && p.progress < 1);
    expect(mid.every((p) => p.total === 1)).toBe(true);
    expect(mid.some((p) => /extracting/.test(p.message ?? ""))).toBe(true);

    // Embed notifications carry chunk counts against the book's real chunk total.
    const embeds = mid.flatMap((p) => {
      const m = EMBED_MSG.exec(p.message ?? "");
      return m ? [{ done: Number(m[1]), of: Number(m[2]) }] : [];
    });
    expect(embeds.length).toBeGreaterThanOrEqual(2);
    for (const e of embeds) {
      expect(e.of).toBe(chunks);
      expect(e.done).toBeGreaterThan(0);
      expect(e.done).toBeLessThan(chunks);
    }
    for (let i = 1; i < embeds.length; i++) expect(embeds[i]!.done).toBeGreaterThan(embeds[i - 1]!.done);

    // Monotonic, and still throttled: no two notifications closer than the window, except completion.
    for (let i = 1; i < sent.length; i++) {
      expect(sent[i]!.progress).toBeGreaterThan(sent[i - 1]!.progress);
      if (i < sent.length - 1) expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(THROTTLE_MS);
    }
    // The whole build ran ≥ chunks × 50 ms of fake time; a burst would far exceed this bound.
    const elapsed = sent.at(-1)!.at - sent[0]!.at;
    expect(sent.length).toBeLessThanOrEqual(Math.floor(elapsed / THROTTLE_MS) + 2);
  });

  it("keeps whole-book progress steps across a multi-book build", async () => {
    const sent: Sent[] = [];
    const r = await buildIndexTool.handler(args({ ids: [1, 2] }), deps(), progressCtx(sent));
    expect(r.structuredContent).toMatchObject({ booksRequested: 2, booksIndexed: 2 });

    expect(sent.find((p) => p.progress === 1)).toMatchObject({ total: 2, message: "Indexed 1/2 book(s)" });
    expect(sent.at(-1)).toMatchObject({ progress: 2, total: 2, message: "Indexed 2/2 book(s)" });
    // The second book's sub-progress sits between 1 and 2, labelled as book 2 of 2.
    const second = sent.filter((p) => p.progress > 1 && p.progress < 2);
    expect(second.some((p) => EMBED_MSG.test(p.message ?? ""))).toBe(true);
    expect(second.every((p) => (p.message ?? "").includes("2/2"))).toBe(true);
  });

  it("builds the same index without a progress callback (no progressToken)", async () => {
    const r = await buildIndexTool.handler(args({ bookId: 1 }), deps(), { signal: new AbortController().signal });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ booksRequested: 1, booksIndexed: 1 });
  });
});
