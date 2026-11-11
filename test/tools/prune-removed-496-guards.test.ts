// #496 review: the guards around the post-write index prune — merge prunes only after a
// confirmed trash step, and the no-wait store path always restores the configured busy wait.

import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliTimeoutError, CalibreHttpError } from "../../src/domain/errors.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore, type IndexedChunk } from "../../src/semantic/store/index.js";
import { IndexConnections } from "../../src/semantic/store/schema.js";
import { IndexFileOwners } from "../../src/semantic/store/library-owner.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import type { ToolDeps } from "../../src/tools/deps.js";

vi.mock("../../src/calibre/http.js", () => ({
  downloadToFile: vi.fn(async () => ({ bytes: 1 })),
}));

const LIB = "Programming_Books";

const book = (id: number): Book => ({
  id,
  uuid: `u${id}`,
  title: `Book ${id}`,
  authors: ["A"],
  identifiers: {},
  formats: ["epub"],
  tags: [],
  languages: [],
});

function chunk(body: string): IndexedChunk {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return { body, charStart: 0, charEnd: body.length, vector: l2normalize(v) };
}

/** A real in-memory index holding 10 and 12, with deleteBooks spied on. */
function spiedIndex() {
  const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  for (const id of [10, 12]) store.replaceBook(LIB, { bookId: id, title: `Book ${id}`, authors: [] }, [chunk("x")]);
  const deleteBooks = vi.spyOn(store, "deleteBooks");
  return { store, deleteBooks };
}

/** A library whose `calibredb remove` always throws `err` and never lands: both books stay readable. */
function failingRemoveDeps(index: SqliteIndexStore, err: Error) {
  const live = new Map([10, 12].map((id) => [id, book(id)] as const));
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
  const calibredb = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "remove") throw err;
    return { stdout: "", stderr: "" };
  });
  return {
    config: loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "1" }),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index,
    log,
  };
}

const merge = (deps: ReturnType<typeof failingRemoveDeps>) =>
  mergeBooksTool.handler({ targetId: 10, sourceIds: [12], mode: "merge", confirm: true }, deps);

describe("calibre_merge_books prunes only after a confirmed trash step (#496)", () => {
  it("should_not_prune_when_the_remove_step_failed", async () => {
    const { store, deleteBooks } = spiedIndex();
    const r = await merge(failingRemoveDeps(store, new Error("HTTP Error 403: Forbidden")));
    expect(r.structuredContent?.indexNote).toBeUndefined();
    expect(deleteBooks).not.toHaveBeenCalled();
    expect(store.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([10, 12]);
  });

  it("should_not_prune_when_a_timed_out_remove_is_not_confirmed_by_the_re_read", async () => {
    const { store, deleteBooks } = spiedIndex();
    const r = await merge(failingRemoveDeps(store, new CalibreCliTimeoutError("calibredb timed out")));
    expect(r.structuredContent?.status).toBe("incomplete");
    expect(r.structuredContent?.indexNote).toBeUndefined();
    expect(deleteBooks).not.toHaveBeenCalled();
    expect(store.indexedBookIds(LIB).sort((a, b) => a - b)).toEqual([10, 12]);
  });
});

describe("IndexConnections.withoutBusyWait restores the configured wait (#496)", () => {
  const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:", CALIBRE_MCP_INDEX_BUSY_TIMEOUT_MS: "4321" });
  const conn = () => new IndexConnections(cfg, log, new IndexFileOwners(":memory:"));
  const busyTimeout = (c: IndexConnections) => c.db(LIB).prepare("PRAGMA busy_timeout").get() as { timeout: number };

  it("should_run_fn_with_no_wait_and_restore_the_wait_when_fn_returns", () => {
    const c = conn();
    const inside = c.withoutBusyWait(LIB, (db) => db.prepare("PRAGMA busy_timeout").get() as { timeout: number });
    expect([inside, busyTimeout(c)]).toEqual([{ timeout: 0 }, { timeout: 4321 }]);
  });

  it("should_restore_the_wait_when_fn_throws", () => {
    const c = conn();
    expect(() =>
      c.withoutBusyWait(LIB, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(busyTimeout(c)).toEqual({ timeout: 4321 });
  });
});
