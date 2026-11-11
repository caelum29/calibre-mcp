// #563 review: identifier scheme names are case-insensitive — Calibre stores types lowercased,
// so `ISBN` sets or removes the book's `isbn` instead of adding a second key.

import { describe, it, expect, vi } from "vitest";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "./fake-ports.js";

const ids = { isbn: "old", url: "u", amazon: "a" };
const book = (id: number): Book => ({
  id,
  uuid: `u-${id}`,
  title: "T",
  authors: ["A"],
  identifiers: { ...ids },
  formats: ["pdf"],
  tags: [],
  languages: [],
});

const ok = async (_args: readonly string[], _opts?: unknown) => ({ stdout: "", stderr: "" });

function deps(calibredb: typeof ok, bookIds: number[]): BaseDeps {
  return {
    config: loadConfig({}),
    content: fakeContent({
      resolveLibraryId: async (name) => asLibId(name ?? "Programming_Books"),
      getBook: async (id: number) => book(id),
      booksByIds: async (want) => new Map(want.map((id) => [id, book(id)] as const)),
      search: async () => ({
        bookIds,
        total: bookIds.length,
        num: bookIds.length,
        offset: 0,
        sort: "title",
        libraryId: "Lib",
      }),
    }),
    calibre: fakeCalibre({ calibredb }),
    extractor: fakeExtractor(),
    figures: fakeFigures(),
    embedder: fakeEmbedder(),
    log,
  };
}

describe("calibre_update_book — scheme names are case-insensitive (#563)", () => {
  it("sets the existing lowercase scheme from an uppercase name", async () => {
    const spy = vi.fn(ok);
    await updateBookTool.handler({ id: 7, changes: { identifiers: { ISBN: "x" } } }, deps(spy, [7]));
    expect(spy.mock.calls[0]?.[0]).toEqual(["set_metadata", "7", "--field", "identifiers:isbn:x,url:u,amazon:a"]);
  });

  it("removes the existing lowercase scheme from an uppercase null", async () => {
    const spy = vi.fn(ok);
    await updateBookTool.handler({ id: 7, changes: { identifiers: { ISBN: null } } }, deps(spy, [7]));
    expect(spy.mock.calls[0]?.[0]).toEqual(["set_metadata", "7", "--field", "identifiers:url:u,amazon:a"]);
  });
});

describe("calibre_bulk_update — scheme names are case-insensitive (#563)", () => {
  it("sets the existing lowercase scheme on every book", async () => {
    const spy = vi.fn(ok);
    await bulkUpdateTool.handler(
      { changes: { identifiers: { ISBN: "x" } }, ids: [1, 2], preview: false },
      deps(spy, [1, 2]),
    );
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      ["set_metadata", "1", "--field", "identifiers:isbn:x,url:u,amazon:a"],
      ["set_metadata", "2", "--field", "identifiers:isbn:x,url:u,amazon:a"],
    ]);
  });

  it("removes the existing lowercase scheme on every book", async () => {
    const spy = vi.fn(ok);
    await bulkUpdateTool.handler(
      { changes: { identifiers: { ISBN: null } }, ids: [1, 2], preview: false },
      deps(spy, [1, 2]),
    );
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      ["set_metadata", "1", "--field", "identifiers:url:u,amazon:a"],
      ["set_metadata", "2", "--field", "identifiers:url:u,amazon:a"],
    ]);
  });
});
