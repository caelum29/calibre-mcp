// #627: the dev script that pairs each semantic search with the reads that follow it in the log.

import { describe, it, expect } from "vitest";
import { pairSearchReads } from "../scripts/pair-search-reads.js";

const T0 = Date.parse("2026-11-16T10:00:00Z");
let seq = 0;
function line(sec: number, tool: string, meta: Record<string, unknown>, pid = 1): string {
  seq += 1;
  return JSON.stringify({
    ts: new Date(T0 + sec * 1000).toISOString(),
    lvl: "info",
    msg: "tool call",
    pid,
    tool,
    call: `c${seq}`,
    meta: { durationMs: 5, isError: false, ...meta },
  });
}
const hit = (bookId: number, charStart: number) => ({ rank: 0, bookId, charStart });
const ranked = (hs: { bookId: number; charStart: number }[]) => hs.map((h, i) => ({ ...h, rank: i + 1 }));

const LINES = [
  // S1: library search, agent then opens book 11 (hit #2) by offset
  line(0, "calibre_semantic_search", {
    args: { query: "q1", scope: "library" },
    hits: ranked([hit(10, 0), hit(11, 400), hit(12, 9)]),
    textChars: 100,
  }),
  line(30, "calibre_get_content", { args: { id: 11, offset: 400 }, textChars: 1000 }),
  // S2: book scope on book 20; agent reads offset 5100 → hit with greatest charStart <= 5100 is #2 (5000)
  line(60, "calibre_semantic_search", {
    args: { query: "q2", scope: "book", bookId: 20 },
    hits: ranked([hit(20, 100), hit(20, 5000), hit(20, 9000)]),
    textChars: 200,
  }),
  line(80, "calibre_get_content", { args: { id: 20, offset: 5100 }, textChars: 2000 }),
  // S3: low-confidence library search, then a cursor-only read (unpairable), then S4 (a retry)
  line(200, "calibre_semantic_search", {
    args: { query: "q3", scope: "library" },
    hits: ranked([hit(30, 1)]),
    lowConfidence: true,
    maxRerank: 0.1,
    textChars: 300,
  }),
  line(210, "calibre_get_content", { args: { cursor: "abc" }, textChars: 3000 }),
  line(220, "calibre_semantic_search", {
    args: { query: "q3b", scope: "library" },
    hits: [],
    textChars: 400,
  }),
  // noise: another process's read and a non-tool-call line must not pair
  line(225, "calibre_get_content", { args: { id: 10, offset: 5 } }, 2),
  JSON.stringify({ ts: new Date(T0).toISOString(), lvl: "info", msg: "server started", pid: 1 }),
];

describe("pairSearchReads", () => {
  it("should_count_searches_reads_ranks_unpairables_and_retries", () => {
    const r = pairSearchReads(LINES, 180);
    expect({
      searchesByScope: r.searchesByScope,
      followedByRead: r.followedByRead,
      openedRanks: r.openedRanks,
      cursorOnlyReads: r.cursorOnlyReads,
      lowConfidenceRetries: r.lowConfidenceRetries,
    }).toEqual({
      searchesByScope: { library: 3, book: 1 },
      followedByRead: { withOffset: 2, withoutOffset: 0 },
      openedRanks: [2, 2],
      cursorOnlyReads: 1,
      lowConfidenceRetries: 1,
    });
  });

  it("should_report_median_and_p95_of_result_sizes_by_tool_and_search_scope", () => {
    const r = pairSearchReads(LINES, 180);
    expect(r.sizes).toEqual({
      "calibre_semantic_search:library": { textChars: { n: 3, median: 300, p95: 400 } },
      "calibre_semantic_search:book": { textChars: { n: 1, median: 200, p95: 200 } },
      calibre_get_content: { textChars: { n: 4, median: 2000, p95: 3000 } },
    });
  });

  it("should_not_pair_a_read_outside_the_window", () => {
    const r = pairSearchReads(LINES, 20);
    expect(r.followedByRead).toEqual({ withOffset: 0, withoutOffset: 0 });
  });
});
