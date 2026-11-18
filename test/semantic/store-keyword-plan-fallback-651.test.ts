// #651 fallback: when the fts5vocab adapter cannot be built on a connection (an SQLite without
// fts5vocab, a refused temp table), the keyword half keeps today's MATCH and reports no plan.

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";

vi.mock("../../src/semantic/store/term-stats.js", () => ({
  fts5TermStats: () => {
    throw new Error("no such module: fts5vocab");
  },
}));

const LIB = "Plan_Lib";
const stores: SqliteIndexStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

function storeOf(bodies: string[]): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  stores.push(s);
  bodies.forEach((body, i) =>
    s.replaceBook(LIB, { bookId: i + 1, title: `Book ${i + 1}`, authors: ["A"] }, [
      { charStart: 0, charEnd: body.length, body },
    ]),
  );
  return s;
}

const BODIES = ["the zeta function", "the borrow checker", "the async runtime", "lock free queues"];

describe("store keyword half without term statistics (#651)", () => {
  it("should_match_on_every_word_as_before_when_fts5vocab_fails", () => {
    const s = storeOf(BODIES);
    expect(s.searchLibraryFts(LIB, "the zeta", 10).map((h) => h.bookId)).toEqual([1, 2, 3]);
  });

  it("should_report_no_plan_when_fts5vocab_fails", () => {
    const s = storeOf(BODIES);
    expect(s.keywordDropped(LIB, "the zeta")).toBeUndefined();
  });
});
