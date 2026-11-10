// #414 review: the owner claim is atomic across processes (Claude Desktop and Claude Code each run
// a server on one index dir), and the case-clash cases the old caseCollisionOwner tests covered
// still hold under the first-indexed-owns rule.

import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { LibraryIdCollisionError } from "../../src/domain/library-id-collision.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { IndexFileOwners } from "../../src/semantic/store/library-owner.js";

const dirs: string[] = [];
const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const c of closers.splice(0)) c.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const scratch = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), "library-owner-claim-414-"));
  dirs.push(d);
  return d;
};

const store = (dir: string): SqliteIndexStore => {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }), log);
  closers.push(s);
  return s;
};

function indexFirst(dir: string, libraryId: string): void {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }), log);
  s.replaceBook(libraryId, { bookId: 1, title: "T", authors: ["A"] }, [
    { body: "ownership", charStart: 0, charEnd: 9 },
  ]);
  s.close();
}

/** A pre-#414 index: built, then its owner record removed. Returns the file path. */
function legacyFile(dir: string): string {
  indexFirst(dir, "books");
  const file = path.join(dir, "books.sqlite");
  const db = new DatabaseSync(file);
  db.exec("DELETE FROM meta WHERE key = 'library_id'");
  db.close();
  return file;
}

const connect = (file: string): DatabaseSync => {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 2000");
  closers.push(db);
  return db;
};

/**
 * `db` whose second prepare() first runs `between`: the other process claims right after this
 * one's first statement, the interleaving a non-atomic read-then-insert loses.
 */
function interleaved(db: DatabaseSync, between: () => void): DatabaseSync {
  let calls = 0;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (++calls === 2) between();
          return target.prepare(sql);
        };
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** What a claim did: "ok", the typed refusal's owner, or any other error's message. */
function outcome(fn: () => void): string {
  try {
    fn();
    return "ok";
  } catch (err) {
    if (err instanceof LibraryIdCollisionError) return `refused, owner ${err.owner}`;
    return `error: ${(err as Error).message}`;
  }
}

const ownerOf = (file: string): unknown =>
  connect(file).prepare("SELECT value FROM meta WHERE key = 'library_id'").get()?.value;

describe("owner claim from two processes at once (#414 review)", () => {
  it("should_let_both_claims_of_the_same_id_succeed", () => {
    const dir = scratch();
    const file = legacyFile(dir);
    let other = "";
    const mine = outcome(() =>
      new IndexFileOwners(dir).claim(
        interleaved(connect(file), () => {
          other = outcome(() => new IndexFileOwners(dir).claim(connect(file), "books"));
        }),
        "books",
      ),
    );
    expect([mine, other, ownerOf(file)]).toEqual(["ok", "ok", "books"]);
  });

  it("should_give_one_owner_and_a_typed_refusal_when_two_case_variants_claim_at_once", () => {
    const dir = scratch();
    const file = legacyFile(dir);
    let other = "";
    const mine = outcome(() =>
      new IndexFileOwners(dir).claim(
        interleaved(connect(file), () => {
          other = outcome(() => new IndexFileOwners(dir).claim(connect(file), "Books"));
        }),
        "books",
      ),
    );
    const results = [mine, other].sort();
    expect([results, ownerOf(file)]).toEqual([["ok", "refused, owner books"], "books"]);
  });
});

describe("case clashes under the first-indexed-owns rule (#414 review)", () => {
  it("should_refuse_both_other_variants_in_a_three_way_clash", () => {
    const dir = scratch();
    indexFirst(dir, "books");
    const s = store(dir);
    expect([s.libraryIdCollision("Books")?.owner, s.libraryIdCollision("BOOKS")?.owner]).toEqual(["books", "books"]);
  });

  it("should_leave_plainly_distinct_ids_alone_each_with_its_own_index", () => {
    const dir = scratch();
    indexFirst(dir, "rust");
    indexFirst(dir, "golang");
    const s = store(dir);
    expect([
      s.libraryIdCollision("rust"),
      s.libraryIdCollision("golang"),
      s.hasIndex("rust"),
      s.hasIndex("golang"),
    ]).toEqual([undefined, undefined, true, true]);
  });

  it("should_not_collide_an_id_with_itself_when_it_reopens_its_own_index", () => {
    const dir = scratch();
    indexFirst(dir, "books");
    const s = store(dir);
    expect([s.libraryIdCollision("books"), s.searchLibraryFts("books", "ownership", 5).map((h) => h.bookId)]).toEqual([
      undefined,
      [1],
    ]);
  });
});
