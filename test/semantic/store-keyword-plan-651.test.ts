// The store's keyword half runs the #651 plan over its own library's statistics: a word in more
// than half of the chunks no longer pulls books into the pool, the drop list is reported, and the
// statistics follow the store's own writes (which never move PRAGMA data_version).

import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

const LIB = "Plan_Lib";
const stores: SqliteIndexStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

/** One single-chunk book per body, ids 1..n, keyword-only (no vectors). */
function storeOf(bodies: string[]): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  stores.push(s);
  bodies.forEach((body, i) => addBook(s, i + 1, body));
  return s;
}

function addBook(s: SqliteIndexStore, bookId: number, body: string): void {
  s.replaceBook(LIB, { bookId, title: `Book ${bookId}`, authors: ["A"] }, [
    { charStart: 0, charEnd: body.length, body },
  ]);
}

// "the" sits in 3 of 4 chunks (0.75 > 0.5); "zeta" in one
const BODIES = ["the zeta function", "the borrow checker", "the async runtime", "lock free queues"];

describe("store keyword half with the #651 plan", () => {
  it("should_not_match_books_on_a_pruned_word_alone", () => {
    const s = storeOf(BODIES);
    expect(s.searchLibraryFts(LIB, "the zeta", 10).map((h) => h.bookId)).toEqual([1]);
  });

  it("should_prune_in_book_scope_with_the_library_statistics", () => {
    const s = storeOf(BODIES);
    expect(s.searchBookFts(LIB, 2, "the zeta", 10)).toEqual([]);
  });

  it("should_report_the_dropped_terms_of_a_query", () => {
    const s = storeOf(BODIES);
    expect(s.keywordDropped(LIB, "the zeta the")).toEqual([
      { term: "the", reason: "too-common" },
      { term: "the", reason: "duplicate" },
    ]);
  });

  it("should_recompute_the_shares_after_its_own_write", () => {
    const s = storeOf(BODIES);
    expect(s.searchLibraryFts(LIB, "lock zeta", 10).map((h) => h.bookId)).toEqual([1, 4]);
    // "lock" now in 4 of 7 chunks: the cached share (1 of 4) must not survive the write
    addBook(s, 5, "lock striping");
    addBook(s, 6, "lock ordering");
    addBook(s, 7, "lock elision");
    expect(s.keywordDropped(LIB, "lock zeta")).toEqual([{ term: "lock", reason: "too-common" }]);
  });
});
