// calibre_ping Index section (#318 → #325): keyword-only rows are labelled, one 5 s budget covers
// libraryInfo + every count against a hanging Content Server, the count never trips the busy
// breaker, and a corrupt or empty index file degrades to "index unreadable" without being written.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import type { StatusIndex } from "../../src/semantic/status.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";
import { type PingDeps, pingTool as ping } from "../../src/tools/calibre_ping.js";

const MAP = { Programming_Books: "Programming Books" };
const META = { modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION };
const BUDGET_MS = 5000;

interface Over {
  libraryInfo?: () => Promise<unknown>;
  search?: (p: { library?: string; noBreaker?: boolean; timeoutMs?: number }) => Promise<{ total: number }>;
  booksMissingVectors?: number;
}

function deps(o: Over = {}): PingDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      libraryInfo: o.libraryInfo ?? (async () => ({ libraryMap: MAP, defaultLibrary: "Programming_Books" })),
      search: o.search ?? (async () => ({ total: 1092 })),
    } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "" } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
    index: {
      hasIndex: () => true,
      indexMeta: () => META,
      stats: () => ({ books: 1064, chunks: 10, figures: 0 }),
      vectorCount: () => 1,
      booksMissingVectors: () => o.booksMissingVectors ?? 0,
    } satisfies StatusIndex,
    log,
  };
}

const text = (r: ToolResult): string => r.content.map((b) => (b as { text?: string }).text ?? "").join("\n");
const indexLine = (r: ToolResult): string | undefined =>
  text(r)
    .split("\n")
    .find((l) => l.startsWith("Index:"));
const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** Settle `p` under fake timers, reporting whether it settled by `ms` of fake time. */
async function settledBy(p: Promise<ToolResult>, ms: number): Promise<boolean> {
  let done = false;
  void p.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(ms);
  return done;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("calibre_ping Index line — keyword-only rows (#318)", () => {
  // Keyword-only books are FTS-searchable (the keyword half of hybrid search finds them), so they
  // count as indexed — but semantic search can't reach them, so the line says how many.
  it("should_label_books_without_embeddings_in_the_index_line", async () => {
    const r = await ping.handler({}, deps({ booksMissingVectors: 40 }));
    expect(indexLine(r)).toBe("Index: Programming Books: 1064/1092 indexed (40 without embeddings)");
  });

  it("should_mirror_the_count_in_structuredContent", async () => {
    const r = await ping.handler({}, deps({ booksMissingVectors: 40 }));
    expect((r.structuredContent as { indexes: unknown[] }).indexes).toEqual([
      {
        id: "Programming_Books",
        name: "Programming Books",
        state: "ok",
        indexed: 1064,
        total: 1092,
        withoutEmbeddings: 40,
      },
    ]);
  });

  it("should_add_no_label_when_every_book_has_embeddings", async () => {
    const r = await ping.handler({}, deps({ booksMissingVectors: 0 }));
    expect(indexLine(r)).toBe("Index: Programming Books: 1064/1092 indexed");
  });
});

describe("calibre_ping Index budget against a slow Content Server (#318)", () => {
  it("should_finish_within_the_budget_when_the_count_hangs", async () => {
    vi.useFakeTimers();
    const p = ping.handler({}, deps({ search: never }));
    expect(await settledBy(p, BUDGET_MS)).toBe(true);
    expect(indexLine(await p)).toBe("Index: Programming Books: 1064/? indexed");
  });

  it("should_report_libraries_unavailable_within_the_budget_when_libraryInfo_hangs", async () => {
    vi.useFakeTimers();
    const p = ping.handler({}, deps({ libraryInfo: never }));
    expect(await settledBy(p, BUDGET_MS)).toBe(true);
    expect(indexLine(await p)).toBe("Index: libraries unavailable");
  });

  it("should_share_one_budget_between_a_slow_libraryInfo_and_a_hanging_count", async () => {
    vi.useFakeTimers();
    const slowInfo = () =>
      new Promise((resolve) => setTimeout(() => resolve({ libraryMap: MAP, defaultLibrary: "" }), 3000));
    const p = ping.handler({}, deps({ libraryInfo: slowInfo, search: never }));
    expect(await settledBy(p, BUDGET_MS)).toBe(true);
  });

  it("should_give_the_count_only_the_budget_left_after_libraryInfo", async () => {
    vi.useFakeTimers();
    const seen: Array<number | undefined> = [];
    const slowInfo = () =>
      new Promise((resolve) => setTimeout(() => resolve({ libraryMap: MAP, defaultLibrary: "" }), 3000));
    const search = async (q: { timeoutMs?: number }) => {
      seen.push(q.timeoutMs);
      return { total: 1092 };
    };
    const p = ping.handler({}, deps({ libraryInfo: slowInfo, search }));
    await vi.advanceTimersByTimeAsync(BUDGET_MS);
    await p;
    expect(seen).toEqual([BUDGET_MS - 3000]);
  });

  it("should_not_flag_the_library_busy_when_the_count_times_out_on_a_real_client", async () => {
    vi.useFakeTimers();
    const config = loadConfig({ CALIBRE_MCP_SERVER_URL: "http://cs.test:8080", CALIBRE_MCP_INDEX_DIR: ":memory:" });
    const busy = new LibraryBusyTracker();
    const content = new ContentServerClient(config, busy);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/ajax/library-info")) {
        return new Response(JSON.stringify({ library_map: MAP, default_library: "Programming_Books" }));
      }
      // /ajax/search: hang until the client aborts on its own timeout
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    });
    const p = ping.handler({}, { ...deps(), content });
    await vi.advanceTimersByTimeAsync(BUDGET_MS + 100);
    await p;
    expect(busy.busyLibraries()).toEqual([]);
  });
});

describe("calibre_ping Index line — corrupt or empty index file (#318)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function storeWith(content: string): { store: SqliteIndexStore; dir: string; file: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "ping-index-"));
    dirs.push(dir);
    const file = path.join(dir, "Programming_Books.sqlite");
    writeFileSync(file, content);
    return { store: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir })), dir, file };
  }

  it.each([
    ["a corrupt file", "this is not a sqlite database at all, just garbage bytes ".repeat(20)],
    ["an empty file", ""],
  ])("should_report_%s_as_unreadable_without_writing_to_it", async (_name, content) => {
    const { store, dir, file } = storeWith(content);
    const r = await ping.handler({}, { ...deps(), index: store });
    expect({
      line: indexLine(r),
      unchanged: readFileSync(file, "utf8") === content,
      files: readdirSync(dir),
    }).toEqual({
      line: "Index: Programming Books: index unreadable",
      unchanged: true,
      files: ["Programming_Books.sqlite"],
    });
  });
});
