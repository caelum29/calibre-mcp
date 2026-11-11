// #496 review: ping's live-id walk has its own cap inside the shared 5 s budget, so one big or
// slow library can't starve the others, and a count it could not check says so.

import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryIndexReport, type LibraryIndexDeps } from "../../src/app/library-index.js";
import type { SearchParams } from "../../src/domain/search.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";

const META = { modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION };
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** Big: `bigTotal` live books, each page answering after `pageMs`; Small: 3 books, instant. Both index orphan 99999. */
function deps(bigTotal: number, pageMs: number, searches: SearchParams[] = []): LibraryIndexDeps {
  return {
    content: {
      libraryInfo: async () => ({ libraryMap: { Big: "Big", Small: "Small" }, defaultLibrary: "Big" }),
      search: async (p) => {
        searches.push(p);
        const total = p.library === "Big" ? bigTotal : 3;
        const from = p.offset ?? 0;
        const bookIds = ids(from + 1, Math.max(0, Math.min(p.num ?? total, total - from)));
        if (p.library === "Big") await new Promise((r) => setTimeout(r, pageMs));
        return { bookIds, total, num: bookIds.length, offset: from, sort: "id", libraryId: p.library ?? "" };
      },
    },
    index: {
      hasIndex: () => true,
      indexMeta: () => META,
      stats: (id) => ({ books: id === "Big" ? 1001 : 3, chunks: 1, figures: 0 }),
      indexedBookIds: (id) => (id === "Big" ? [...ids(1, 1000), 99999] : [1, 2, 99999]),
      booksMissingVectors: () => 0,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ping's live-id walk is capped (#496 review)", () => {
  it("should_stop_a_slow_10k_book_walk_early_mark_its_count_unchecked_and_still_report_the_other_library", async () => {
    vi.useFakeTimers();
    let settled: unknown = "pending";
    const at = { ms: -1 };
    const t0 = Date.now();
    void libraryIndexReport(deps(10_000, 600)).then((r) => {
      settled = r;
      at.ms = Date.now() - t0;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toEqual([
      // walk cut off by its own cap: raw row count, flagged; the total came with the first page
      {
        id: "Big",
        name: "Big",
        isDefault: true,
        state: "ok",
        indexed: 1001,
        total: 10_000,
        withoutEmbeddings: 0,
        indexedUnchecked: true,
      },
      // checked against the library: orphan 99999 not counted
      { id: "Small", name: "Small", isDefault: false, state: "ok", indexed: 2, total: 3, withoutEmbeddings: 0 },
    ]);
    // first page (600 ms) + the walk's own 2 s cap, well inside the shared 5 s budget
    expect(at.ms).toBeLessThanOrEqual(2600);
  });

  it("should_stop_after_the_page_cap_even_when_pages_are_fast", async () => {
    vi.useFakeTimers();
    const searches: SearchParams[] = [];
    let settled: unknown = "pending";
    void libraryIndexReport(deps(6000, 1, searches)).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(100);
    expect(searches.filter((s) => s.library === "Big")).toHaveLength(5);
    expect((settled as Array<Record<string, unknown>>)[0]).toMatchObject({ indexed: 1001, indexedUnchecked: true });
  });

  it("should_count_only_live_rows_when_the_walk_finishes", async () => {
    const out = await libraryIndexReport(deps(1500, 0));
    expect(out?.[0]).toEqual({
      id: "Big",
      name: "Big",
      isDefault: true,
      state: "ok",
      indexed: 1000,
      total: 1500,
      withoutEmbeddings: 0,
    });
  });
});
