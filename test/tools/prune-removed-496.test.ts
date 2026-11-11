// #496: a confirmed remove or merge drops the vanished ids from the semantic index (best-effort),
// so semantic search stops returning books the library no longer holds; ping counts live books only.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliTimeoutError, CalibreHttpError } from "../../src/domain/errors.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import { SqliteIndexStore, type IndexedChunk } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { stemText } from "../../src/semantic/stem.js";
import { libraryIndexReport, type LibraryIndexDeps } from "../../src/app/library-index.js";
import { removeBookTool } from "../../src/tools/calibre_remove_book.js";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

vi.mock("../../src/calibre/http.js", () => ({
  downloadToFile: vi.fn(async () => ({ bytes: 1 })),
}));

const LIB = "Programming_Books";
const NOTE =
  "Semantic index not updated: the index is busy (another process holds it). " +
  "The removed book(s) can still show up in calibre_semantic_search until calibre_build_index runs with prune=true.";

const book = (id: number, over: Partial<Book> = {}): Book => ({
  id,
  uuid: `u${id}`,
  title: `Book ${id}`,
  authors: ["A"],
  identifiers: {},
  formats: ["epub"],
  tags: [],
  languages: [],
  ...over,
});

function chunk(body: string): IndexedChunk {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return { body, charStart: 0, charEnd: body.length, vector: l2normalize(v) };
}

/** An index holding books 10, 12 and 13, each with one "ownership" chunk. */
function seeded(store: SqliteIndexStore): SqliteIndexStore {
  for (const id of [10, 12, 13])
    store.replaceBook(LIB, { bookId: id, title: `Book ${id}`, authors: [] }, [chunk("ownership moves")]);
  return store;
}
const memoryIndex = () => seeded(new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })));

/** An index whose prune throws SQLITE_BUSY, the way a locked file does. */
function busyIndex(): ToolDeps["index"] {
  const real = memoryIndex();
  return new Proxy(real, {
    get(target, prop, recv) {
      if (prop === "deleteBooks")
        return () => {
          throw Object.assign(new Error("database is locked"), { errcode: 5 });
        };
      const v = Reflect.get(target, prop, recv) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

interface FakeOpts {
  index: ToolDeps["index"];
  /** calibredb outcome per subcommand; default = success. */
  fail?: Partial<Record<string, Error>>;
  /** Books the library holds before the call. */
  books?: Book[];
}

/** Library + calibredb fake: a `remove` (landed or not) drops the books from later reads. */
function fakeDeps(o: FakeOpts) {
  const live = new Map((o.books ?? [book(10), book(12), book(13)]).map((b) => [b.id, b] as const));
  const calibredb = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "remove") for (const id of args[1]!.split(",")) live.delete(Number(id));
    const err = o.fail?.[args[0]!];
    if (err) throw err;
    return { stdout: "", stderr: "" };
  });
  const content = {
    resolveLibraryId: async (): Promise<string> => LIB,
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, live.get(id) ?? null] as const)),
    getBook: async (id: number): Promise<Book> => {
      const b = live.get(id);
      if (!b) throw new CalibreHttpError(404, "u", "not found");
      return b;
    },
    bookMergeFacts: async () => ({ customFields: [], hasCover: true }),
  };
  const deps = {
    config: loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "1" }),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: o.index,
    log,
  };
  return { deps, calibredb };
}

const text = (r: ToolResult) => (r.content[0] as { text: string }).text;
const hitIds = (s: SqliteIndexStore) => s.searchLibraryFts(LIB, stemText("ownership"), 10).map((h) => h.bookId);

describe("calibre_remove_book prunes the semantic index (#496)", () => {
  it("should_drop_removed_ids_from_the_index_after_a_confirmed_remove", async () => {
    const index = memoryIndex();
    const { deps } = fakeDeps({ index });
    const r = await removeBookTool.handler({ ids: [10, 12], confirm: true }, deps);
    expect(r.isError).toBeFalsy();
    expect(index.indexedBookIds(LIB)).toEqual([13]);
    expect(hitIds(index)).toEqual([13]);
    expect(r.structuredContent?.indexNote).toBeUndefined();
    expect(text(r)).not.toContain("Semantic index");
  });

  it("should_leave_the_index_untouched_on_a_dry_run", async () => {
    const index = memoryIndex();
    const { deps } = fakeDeps({ index });
    await removeBookTool.handler({ ids: [10], confirm: false }, deps);
    expect(index.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([10, 12, 13]);
  });

  it("should_leave_the_index_untouched_when_calibredb_remove_fails", async () => {
    const index = memoryIndex();
    const { deps } = fakeDeps({ index, fail: { remove: new Error("HTTP Error 403: Forbidden") } });
    await removeBookTool.handler({ ids: [10], confirm: true }, deps);
    expect(index.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([10, 12, 13]);
  });

  it("should_keep_the_committed_remove_a_success_and_add_one_note_when_the_prune_fails", async () => {
    const { deps } = fakeDeps({ index: busyIndex() });
    const r = await removeBookTool.handler({ ids: [10, 12], confirm: true }, deps);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.deleted).toBe(true);
    expect(r.structuredContent?.removedIds).toEqual([10, 12]);
    expect(r.structuredContent?.indexNote).toBe(NOTE);
    expect(text(r)).toBe(
      "Removed 2 book(s): 10, 12. They went to Calibre's Trash and can be restored from the Calibre GUI.\n" + NOTE,
    );
  });
});

describe("calibre_merge_books prunes merged-away sources (#496)", () => {
  const books = [book(10, { formats: ["epub"] }), book(12, { formats: ["epub"] }), book(13)];

  it("should_drop_the_sources_but_keep_the_target_after_a_confirmed_merge", async () => {
    const index = memoryIndex();
    const { deps } = fakeDeps({ index, books });
    const r = await mergeBooksTool.handler({ targetId: 10, sourceIds: [12], mode: "merge", confirm: true }, deps);
    expect(r.structuredContent?.status).toBe("merged");
    expect(index.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([10, 13]);
    expect(r.structuredContent?.indexNote).toBeUndefined();
  });

  it("should_prune_when_a_timed_out_remove_is_confirmed_by_the_re_read", async () => {
    const index = memoryIndex();
    const { deps } = fakeDeps({ index, books, fail: { remove: new CalibreCliTimeoutError("calibredb timed out") } });
    const r = await mergeBooksTool.handler({ targetId: 10, sourceIds: [12], mode: "merge", confirm: true }, deps);
    expect(r.structuredContent?.status).toBe("merged");
    expect(index.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([10, 13]);
  });

  it("should_not_prune_in_safe_mode_where_sources_are_kept", async () => {
    const index = memoryIndex();
    const { deps } = fakeDeps({ index, books });
    await mergeBooksTool.handler({ targetId: 10, sourceIds: [12], mode: "safe", confirm: true }, deps);
    expect(index.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([10, 12, 13]);
  });

  it("should_keep_the_merge_a_success_and_add_one_note_when_the_prune_fails", async () => {
    const { deps } = fakeDeps({ index: busyIndex(), books });
    const r = await mergeBooksTool.handler({ targetId: 10, sourceIds: [12], mode: "merge", confirm: true }, deps);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.status).toBe("merged");
    expect(r.structuredContent?.indexNote).toBe(NOTE);
    expect(text(r).split(NOTE)).toHaveLength(2);
  });
});

describe("the prune never waits on a locked index (#496)", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("should_return_the_note_at_once_when_another_process_holds_the_write_lock", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-prune-"));
    // a long busy wait: a prune that waited on the lock would take ~3 s
    const index = seeded(
      new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir, CALIBRE_MCP_INDEX_BUSY_TIMEOUT_MS: "3000" })),
    );
    const holder = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
    holder.exec("BEGIN IMMEDIATE");
    try {
      const { deps } = fakeDeps({ index });
      const t0 = Date.now();
      const r = await removeBookTool.handler({ ids: [10], confirm: true }, deps);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(r.structuredContent?.removedIds).toEqual([10]);
      expect(r.structuredContent?.indexNote).toBe(NOTE);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    // the lock gone, a later search request still waits normally
    expect(index.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([10, 12, 13]);
    index.close();
  });
});

describe("calibre_ping counts only live books as indexed (#496)", () => {
  it("should_not_count_index_rows_of_books_the_library_no_longer_holds", async () => {
    const deps: LibraryIndexDeps = {
      content: {
        libraryInfo: async () => ({ libraryMap: { [LIB]: "Programming Books" }, defaultLibrary: LIB }),
        // the library holds 10, 11, 13; the index also holds orphan 12
        search: async (p) => {
          const all = [10, 11, 13];
          const ids = all.slice(p.offset ?? 0, (p.offset ?? 0) + (p.num ?? all.length));
          return { bookIds: ids, total: 3, num: ids.length, offset: p.offset ?? 0, sort: "id", libraryId: LIB };
        },
      },
      index: {
        hasIndex: () => true,
        indexMeta: () => ({ modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION }),
        stats: () => ({ books: 3, chunks: 3, figures: 0 }),
        indexedBookIds: () => [10, 12, 13],
        booksMissingVectors: () => 0,
      },
    };
    expect(await libraryIndexReport(deps)).toEqual([
      { id: LIB, name: "Programming Books", isDefault: true, state: "ok", indexed: 2, total: 3, withoutEmbeddings: 0 },
    ]);
  });
});
