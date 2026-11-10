// #388 (detect and refuse): library ids equal case-insensitively ("Books"/"books") name ONE index
// file and ONE progress log on case-insensitive APFS. Since #414 the library indexed first owns
// them; every other case variant is refused on every path — the index open (no .sqlite created)
// and calibre_build_index (text + structuredContent) — before any write.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { errorCodeFor } from "../../src/domain/error-codes.js";
import { LibraryIdCollisionError } from "../../src/domain/library-id-collision.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { buildIndexTool, type BuildIndexDeps } from "../../src/tools/calibre_build_index.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "../tools/fake-ports.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A scratch index dir in which library "Books" was indexed first, so it owns the index (#414). */
const ownedByBooks = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), "case-collision-"));
  dirs.push(d);
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: d }), log);
  s.replaceBook("Books", { bookId: 1, title: "T", authors: ["A"] }, [{ body: "ownership", charStart: 0, charEnd: 9 }]);
  s.close();
  return d;
};
const sqliteFiles = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith(".sqlite"));

const MAP = { Books: "Books", books: "books", Programming_Books: "Programming Books" };

describe("LibraryIdCollisionError (#388)", () => {
  it("should_name_both_ids_and_say_to_rename_the_refused_library_folder", () => {
    const err = new LibraryIdCollisionError("books", "Books");
    expect([err.refused, err.owner, /"books"/.test(err.message), /"Books"/.test(err.message)]).toEqual([
      "books",
      "Books",
      true,
      true,
    ]);
    expect(err.message).toContain('Rename the folder of library "books"');
  });

  it("should_map_to_the_library_id_collision_code", () => {
    expect(errorCodeFor(new LibraryIdCollisionError("books", "Books"))).toBe("library_id_collision");
  });
});

describe("index open refuses the later id (#388, #414)", () => {
  const store = (dir: string) => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }), log);

  it("should_throw_LibraryIdCollisionError_on_a_write_open_of_books", () => {
    const s = store(ownedByBooks());
    try {
      expect(() => s.searchLibraryFts("books", "ownership", 5)).toThrow(LibraryIdCollisionError);
    } finally {
      s.close();
    }
  });

  it("should_create_no_index_file_for_books", () => {
    const dir = ownedByBooks();
    const s = store(dir);
    expect(() => s.searchLibraryFts("books", "ownership", 5)).toThrow(LibraryIdCollisionError);
    s.close();
    expect(sqliteFiles(dir)).toEqual(["Books.sqlite"]);
  });

  it("should_throw_on_a_read_only_open_of_books", () => {
    const s = store(ownedByBooks());
    try {
      expect(() => s.stats("books")).toThrow(LibraryIdCollisionError);
    } finally {
      s.close();
    }
  });

  it("should_still_open_Books_under_its_unchanged_file_name", () => {
    const dir = ownedByBooks();
    const s = store(dir);
    try {
      expect(s.searchLibraryFts("Books", "ownership", 5).map((h) => h.bookId)).toEqual([1]);
    } finally {
      s.close();
    }
    expect(sqliteFiles(dir)).toEqual(["Books.sqlite"]);
  });
});

describe("calibre_build_index refuses the later id (#388, #414)", () => {
  function deps(dir: string, libraryId: string): BuildIndexDeps & { index: SqliteIndexStore } {
    const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir });
    return {
      config: cfg,
      content: fakeContent({
        libraryInfo: async () => ({ libraryMap: MAP, defaultLibrary: "Books" }),
        resolveLibraryId: async () => asLibId(libraryId),
      }),
      calibre: fakeCalibre(),
      extractor: fakeExtractor(),
      figures: fakeFigures(),
      embedder: fakeEmbedder(),
      index: new SqliteIndexStore(cfg, log),
      log,
    };
  }
  const build = { ids: [1], library: "books", force: false, enableFts: false, keywordOnly: false, prune: false };

  it("should_return_isError_with_code_and_both_ids_in_text_and_structuredContent", async () => {
    const d = deps(ownedByBooks(), "books");
    const r = await buildIndexTool.handler(build, d);
    d.index.close();
    const text = r.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    const sc = r.structuredContent as { errorCode?: string; error?: string };
    expect({
      isError: r.isError,
      code: sc.errorCode,
      textNamesBoth: text.includes('"books"') && text.includes('"Books"'),
      scNamesBoth: Boolean(sc.error?.includes('"books"') && sc.error.includes('"Books"')),
      textSaysRename: text.includes('Rename the folder of library "books"'),
    }).toEqual({
      isError: true,
      code: "library_id_collision",
      textNamesBoth: true,
      scNamesBoth: true,
      textSaysRename: true,
    });
  });

  it("should_write_nothing_new_to_the_index_dir_when_refused", async () => {
    const dir = ownedByBooks();
    const d = deps(dir, "books");
    await buildIndexTool.handler(build, d);
    d.index.close();
    // only the owner's file; reading its owner may leave SQLite's -wal/-shm beside it
    expect(readdirSync(dir).filter((f) => !/\.sqlite-(wal|shm)$/.test(f))).toEqual(["Books.sqlite"]);
  });
});
