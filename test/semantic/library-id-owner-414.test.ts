// #414 owner rule (Artem, #452 session A): the library indexed FIRST owns the index; its id is
// recorded in the index meta at the first build. A later library whose id differs only in letter
// case is the one refused. A legacy index with no recorded owner is claimed by the first library
// to open it. The check needs no library list, so it holds before the first library resolve.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { LibraryIdCollisionError } from "../../src/domain/library-id-collision.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

const dirs: string[] = [];
const stores: SqliteIndexStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const scratch = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), "library-owner-414-"));
  dirs.push(d);
  return d;
};

// Built exactly as server.ts builds it: no library list, nothing resolved yet.
const open = (dir: string): SqliteIndexStore => {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }), log);
  stores.push(s);
  return s;
};

/** Index one book for `libraryId` in a store of its own, then close it (a finished first build). */
function indexFirst(dir: string, libraryId: string): void {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }), log);
  s.replaceBook(libraryId, { bookId: 1, title: "Rust", authors: ["A"] }, [
    { body: "ownership borrowing", charStart: 0, charEnd: 19 },
  ]);
  s.close();
}

const refusal = (fn: () => unknown): { refused: string; owner: string } | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof LibraryIdCollisionError) return { refused: err.refused, owner: err.owner };
    throw err;
  }
  return undefined;
};

describe("owner rule: the library indexed first owns the index (#414)", () => {
  it("should_keep_the_lower_case_owner_working_when_an_upper_case_id_arrives_later", () => {
    const dir = scratch();
    indexFirst(dir, "books");
    const s = open(dir);
    expect(s.searchLibraryFts("books", "ownership", 5).map((h) => h.bookId)).toEqual([1]);
  });

  it("should_refuse_the_upper_case_id_that_arrives_later", () => {
    const dir = scratch();
    indexFirst(dir, "books");
    expect(refusal(() => open(dir).hasIndex("Books"))).toEqual({ refused: "Books", owner: "books" });
  });

  it("should_refuse_the_lower_case_id_when_the_upper_case_one_was_indexed_first", () => {
    const dir = scratch();
    indexFirst(dir, "Books");
    expect(refusal(() => open(dir).hasIndex("books"))).toEqual({ refused: "books", owner: "Books" });
  });

  it("should_report_the_verdict_without_throwing_through_libraryIdCollision", () => {
    const dir = scratch();
    indexFirst(dir, "books");
    const s = open(dir);
    const err = s.libraryIdCollision("Books");
    expect([err?.refused, err?.owner, s.libraryIdCollision("books")]).toEqual(["Books", "books", undefined]);
  });

  it("should_refuse_before_any_library_was_resolved_with_no_library_list_at_all", () => {
    const dir = scratch();
    indexFirst(dir, "books");
    // a fresh process: knownLibraryIds() would still be empty; the store needs no list
    expect(refusal(() => open(dir).indexMeta("Books"))).toEqual({ refused: "Books", owner: "books" });
  });

  it("should_create_no_index_file_for_the_refused_id", () => {
    const dir = scratch();
    indexFirst(dir, "books");
    const s = open(dir);
    refusal(() => s.searchLibraryFts("Books", "ownership", 5));
    s.close();
    expect(readdirSync(dir).filter((f) => f.endsWith(".sqlite"))).toEqual(["books.sqlite"]);
  });

  it("should_refuse_nothing_while_no_index_exists", () => {
    const s = open(scratch());
    expect([s.libraryIdCollision("books"), s.libraryIdCollision("Books")]).toEqual([undefined, undefined]);
  });
});

describe("legacy index with no recorded owner (#414)", () => {
  /** An index as built before #414: same file, no owner key in its meta. */
  function legacyIndex(dir: string, fileStem: string): void {
    indexFirst(dir, fileStem);
    const db = new DatabaseSync(path.join(dir, `${fileStem}.sqlite`));
    db.exec("DELETE FROM meta WHERE key NOT IN ('model_id', 'dim', 'index_version', 'created_at')");
    db.close();
  }

  it("should_let_the_first_library_to_open_it_claim_it_and_refuse_the_other_afterwards", () => {
    const dir = scratch();
    legacyIndex(dir, "books");
    const first = open(dir);
    first.searchLibraryFts("Books", "ownership", 5); // first touch: "Books" claims the index
    first.close();
    expect(refusal(() => open(dir).hasIndex("books"))).toEqual({ refused: "books", owner: "Books" });
  });
});
