// #388 (option 3, detect and refuse): library ids equal case-insensitively ("Books"/"books") name
// ONE index file and ONE progress log on case-insensitive APFS. The id that sorts first by code
// point keeps its files; every other one is refused on every path — the domain check, the index
// open (no .sqlite created), and calibre_build_index (text + structuredContent) — before any write.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { errorCodeFor } from "../../src/domain/error-codes.js";
import { caseCollisionOwner, LibraryIdCollisionError } from "../../src/domain/library-id-collision.js";
import { libraryIdCollision } from "../../src/app/library-id-guard.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { buildIndexTool, type BuildIndexDeps } from "../../src/tools/calibre_build_index.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "../tools/fake-ports.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), "case-collision-"));
  dirs.push(d);
  return d;
};

const MAP = { Books: "Books", books: "books", Programming_Books: "Programming Books" };

describe("caseCollisionOwner (#388)", () => {
  it("should_refuse_books_in_favour_of_Books", () => {
    expect(caseCollisionOwner("books", ["Books", "books"])).toBe("Books");
  });

  it("should_let_Books_through_whatever_the_list_order", () => {
    expect(caseCollisionOwner("Books", ["books", "Books"])).toBeUndefined();
  });

  it("should_refuse_books_against_a_list_that_lacks_books_itself", () => {
    expect(caseCollisionOwner("books", ["Books"])).toBe("Books");
  });

  it("should_name_the_code_point_first_id_as_owner_in_a_three_way_clash", () => {
    const ids = ["books", "Books", "BOOKS"];
    expect(ids.map((id) => caseCollisionOwner(id, ids))).toEqual(["BOOKS", "BOOKS", undefined]);
  });

  it("should_leave_plain_distinct_ids_alone", () => {
    const ids = ["Programming_Books", "Reaserch_Books", "Humanities", "Magazines"];
    expect(ids.map((id) => caseCollisionOwner(id, ids))).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("should_not_collide_an_id_with_itself", () => {
    expect(caseCollisionOwner("books", ["books"])).toBeUndefined();
  });
});

describe("LibraryIdCollisionError (#388)", () => {
  it("should_name_both_ids_and_say_to_rename_a_folder", () => {
    const err = new LibraryIdCollisionError("books", "Books");
    expect([err.refused, err.owner, /"books"/.test(err.message), /"Books"/.test(err.message)]).toEqual([
      "books",
      "Books",
      true,
      true,
    ]);
    expect(err.message).toMatch(/rename one of the two library folders/i);
  });

  it("should_map_to_the_library_id_collision_code", () => {
    expect(errorCodeFor(new LibraryIdCollisionError("books", "Books"))).toBe("library_id_collision");
  });
});

describe("libraryIdCollision use case (#388)", () => {
  const content = (map: Record<string, string>) => ({
    libraryInfo: async () => ({ libraryMap: map, defaultLibrary: "Books" }),
  });

  it("should_return_the_refusal_for_books", async () => {
    const err = await libraryIdCollision(content(MAP), "books");
    expect([err instanceof LibraryIdCollisionError, err?.refused, err?.owner]).toEqual([true, "books", "Books"]);
  });

  it("should_return_undefined_for_Books", async () => {
    expect(await libraryIdCollision(content(MAP), "Books")).toBeUndefined();
  });

  it("should_not_refuse_when_the_library_list_is_unavailable", async () => {
    const down = {
      libraryInfo: async (): Promise<never> => {
        throw new Error("Content Server down");
      },
    };
    expect(await libraryIdCollision(down, "books")).toBeUndefined();
  });
});

describe("index open refuses the colliding id (#388)", () => {
  const store = (dir: string) =>
    new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }), log, () => Object.keys(MAP));

  it("should_throw_LibraryIdCollisionError_on_a_write_open_of_books", () => {
    const s = store(scratch());
    try {
      expect(() => s.indexedBookIds("books")).toThrow(LibraryIdCollisionError);
    } finally {
      s.close();
    }
  });

  it("should_create_no_index_file_for_books", () => {
    const dir = scratch();
    const s = store(dir);
    try {
      s.indexedBookIds("books");
    } catch {
      /* the refusal itself is asserted above; here only the disk matters */
    }
    s.close();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("should_throw_on_a_read_only_open_of_books", () => {
    const s = store(scratch());
    try {
      expect(() => s.stats("books")).toThrow(LibraryIdCollisionError);
    } finally {
      s.close();
    }
  });

  it("should_still_open_Books_under_its_unchanged_file_name", () => {
    const dir = scratch();
    const s = store(dir);
    try {
      expect(s.indexedBookIds("Books")).toEqual([]);
    } finally {
      s.close();
    }
    expect(readdirSync(dir).filter((f) => f.endsWith(".sqlite"))).toEqual(["Books.sqlite"]);
  });
});

describe("calibre_build_index refuses the colliding id (#388)", () => {
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
      // No provider: the tool's own early check must refuse, not the index-open guard.
      index: new SqliteIndexStore(cfg, log),
      log,
    };
  }

  it("should_return_isError_with_code_and_both_ids_in_text_and_structuredContent", async () => {
    const dir = scratch();
    const d = deps(dir, "books");
    const r = await buildIndexTool.handler(
      { ids: [1], library: "books", force: false, enableFts: false, keywordOnly: false, prune: false },
      d,
    );
    d.index.close();
    const text = r.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    const sc = r.structuredContent as { errorCode?: string; error?: string };
    expect({
      isError: r.isError,
      code: sc.errorCode,
      textNamesBoth: text.includes('"books"') && text.includes('"Books"'),
      scNamesBoth: Boolean(sc.error?.includes('"books"') && sc.error.includes('"Books"')),
      textSaysRename: /rename one of the two library folders/i.test(text),
    }).toEqual({
      isError: true,
      code: "library_id_collision",
      textNamesBoth: true,
      scNamesBoth: true,
      textSaysRename: true,
    });
  });

  it("should_write_nothing_to_the_index_dir_when_refused", async () => {
    const dir = scratch();
    const d = deps(dir, "books");
    await buildIndexTool.handler(
      { ids: [1], library: "books", force: false, enableFts: false, keywordOnly: false, prune: false },
      d,
    );
    d.index.close();
    expect(readdirSync(dir)).toEqual([]);
  });
});
