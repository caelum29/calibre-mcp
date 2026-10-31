// Heartbeat through long silent phases (#245 review): a big PDF's extraction or chunking can
// outlast a client's request timeout before the first embed slice reports, so the build keeps
// sending small increasing progress while those phases run — and stops once the book is done.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { HEARTBEAT_MS } from "../../src/tools/book-progress.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { createProgressReporter, type ProgressNotification } from "../../src/progress.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
import type { ToolDeps } from "../../src/tools/deps.js";

/** Fake extraction wall time — several heartbeat periods. */
const EXTRACT_MS = HEARTBEAT_MS * 3.5;
/** Fake tokenizer cost per call — chunking a big book then spans several heartbeats. */
const MS_PER_TOKEN_COUNT = 200;

const book: Book = {
  id: 1,
  uuid: "u-1",
  title: "Big Print PDF",
  authors: ["Someone"],
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
    return texts.map(() => {
      const v = new Float32Array(EMBED_DIM);
      v[0] = 1;
      return v;
    });
  },
  async warmup() {},
  countTokens: (s) => {
    vi.advanceTimersByTime(MS_PER_TOKEN_COUNT);
    return Math.ceil(s.length / 4) + 2;
  },
};

function deps(getText: () => Promise<ExtractedText>): ToolDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: {
      getBook: async () => book,
      resolveLibraryId: async () => "Programming_Books",
    } as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: { getText } satisfies Partial<ToolDeps["extractor"]> as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder,
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
}

const slowText = async (): Promise<ExtractedText> => {
  await vi.advanceTimersByTimeAsync(EXTRACT_MS);
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
};

function progressCtx(sent: ProgressNotification[]) {
  return {
    signal: new AbortController().signal,
    progress: createProgressReporter({
      progressToken: "tok",
      send: async (p) => {
        sent.push(p);
      },
    }),
  };
}

const args = { bookId: 1, force: false, enableFts: false, keywordOnly: false, prune: false };
const count = (sent: ProgressNotification[], re: RegExp) => sent.filter((p) => re.test(p.message ?? "")).length;

describe("calibre_build_index phase heartbeat (#245)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps sending increasing progress through a long extraction and a long chunking phase", async () => {
    const sent: ProgressNotification[] = [];
    const r = await buildIndexTool.handler(args, deps(slowText), progressCtx(sent));
    expect(r.isError).toBeFalsy();

    // 35 s of extraction at a 10 s heartbeat → 3 beats after the phase-start notification.
    expect(count(sent, /extracting text \(\d+ s\)$/)).toBe(3);
    expect(count(sent, /chunking \(\d+ s\)$/)).toBeGreaterThanOrEqual(2);
    // Heartbeats never reach the next phase or the whole-book step: the sequence stays monotonic.
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.progress).toBeGreaterThan(sent[i - 1]!.progress);
    expect(sent.filter((p) => p.progress < 1).every((p) => p.progress < 0.1 || /embedding/.test(p.message ?? ""))).toBe(
      true,
    );
    expect(sent.at(-1)).toMatchObject({ progress: 1, total: 1, message: "Indexed 1/1 book(s)" });
  });

  it("stops the heartbeat once the build returns", async () => {
    const sent: ProgressNotification[] = [];
    await buildIndexTool.handler(args, deps(slowText), progressCtx(sent));
    const before = sent.length;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 6);
    expect(sent.length).toBe(before);
  });

  it("stops the heartbeat when the book fails mid-extraction", async () => {
    const sent: ProgressNotification[] = [];
    const failing = async (): Promise<ExtractedText> => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2.5);
      throw new Error("EXTRACT_TIMEOUT");
    };
    const r = await buildIndexTool.handler(args, deps(failing), progressCtx(sent));
    expect(r.structuredContent).toMatchObject({ booksIndexed: 0 });
    expect(count(sent, /extracting text \(\d+ s\)$/)).toBe(2);
    const before = sent.length;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 6);
    expect(sent.length).toBe(before);
  });

  // A leaked interval is invisible in the notifications (the reporter drops non-increasing
  // values), so check the timer table itself.
  // keyword-only: no embed phase follows chunking, so only the finally can stop the heartbeat.
  it("leaves no interval behind after a successful keyword-only book", async () => {
    const r = await buildIndexTool.handler({ ...args, keywordOnly: true }, deps(slowText), progressCtx([]));
    expect(r.structuredContent).toMatchObject({ booksIndexed: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no interval behind after a failed book", async () => {
    const failing = async (): Promise<ExtractedText> => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2.5);
      throw new Error("EXTRACT_TIMEOUT");
    };
    await buildIndexTool.handler(args, deps(failing), progressCtx([]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no interval behind after a cancelled build", async () => {
    const controller = new AbortController();
    const cancelled = async (): Promise<ExtractedText> => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 1.5);
      controller.abort();
      throw new Error("aborted");
    };
    const ctx = { ...progressCtx([]), signal: controller.signal };
    const r = await buildIndexTool.handler(args, deps(cancelled), ctx);
    expect(r.structuredContent).toMatchObject({ cancelled: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
