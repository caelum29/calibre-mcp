// FullTextSearch: the "FTS disabled" cache and the per-book snippet loop under a time budget.
import { describe, expect, it, vi } from "vitest";
import { FullTextSearch } from "../../src/calibre/fts.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { CalibreHttpTimeoutError, FtsError } from "../../src/domain/errors.js";
import type { FtsMatches } from "../../src/domain/search.js";
import { Deadline } from "../../src/shared/deadline.js";

const LIB = asLibId("Programming_Books");
const MATCHES: FtsMatches = { bookIds: [1], books: new Map(), indexing: { left: 0, total: 1 } };

/** A manual clock shared by the Deadline and the fake HTTP's simulated latency. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("FullTextSearch.match — FTS disabled", () => {
  it("should_fail_fast_without_http_when_disabled_was_seen_recently", async () => {
    const c = clock();
    const ftsSearch = vi.fn().mockRejectedValue(new FtsError("FTS_DISABLED", LIB));
    const fts = new FullTextSearch({ ftsSearch, ftsSnippets: vi.fn() }, c.now);
    await expect(fts.match("q", LIB, { deadline: new Deadline(45_000, c.now) })).rejects.toMatchObject({
      code: "FTS_DISABLED",
    });
    c.advance(30_000);
    await expect(fts.match("q", LIB, { deadline: new Deadline(45_000, c.now) })).rejects.toMatchObject({
      code: "FTS_DISABLED",
    });
    expect(ftsSearch).toHaveBeenCalledTimes(1);
  });

  it("should_ask_calibre_again_once_the_disabled_answer_expires", async () => {
    const c = clock();
    const ftsSearch = vi.fn().mockRejectedValueOnce(new FtsError("FTS_DISABLED", LIB)).mockResolvedValueOnce(MATCHES);
    const fts = new FullTextSearch({ ftsSearch, ftsSnippets: vi.fn() }, c.now);
    await expect(fts.match("q", LIB, { deadline: new Deadline(45_000, c.now) })).rejects.toBeInstanceOf(FtsError);
    c.advance(61_000);
    await expect(fts.match("q", LIB, { deadline: new Deadline(45_000, c.now) })).resolves.toBe(MATCHES);
  });

  it("should_hand_the_http_call_the_deadline_remainder_as_its_timeout", async () => {
    const c = clock();
    const ftsSearch = vi.fn().mockResolvedValue(MATCHES);
    const fts = new FullTextSearch({ ftsSearch, ftsSnippets: vi.fn() }, c.now);
    const deadline = new Deadline(45_000, c.now);
    c.advance(5_000); // e.g. spent on bundle listing
    await fts.match("q", LIB, { deadline });
    expect(ftsSearch.mock.calls[0]![2]).toMatchObject({ timeoutMs: 40_000 });
  });
});

describe("FullTextSearch.snippets — per-book budget", () => {
  it("should_fetch_one_book_per_request", async () => {
    const c = clock();
    const ftsSnippets = vi.fn(async (_q: string, _l: unknown, ids: number[]) => new Map([[ids[0]!, ["s"]]]));
    const fts = new FullTextSearch({ ftsSearch: vi.fn(), ftsSnippets }, c.now);
    const batch = await fts.snippets("q", LIB, [1, 2, 3], { deadline: new Deadline(45_000, c.now) });
    expect(ftsSnippets.mock.calls.map((call) => call[2])).toEqual([[1], [2], [3]]);
    expect(batch.skipped).toEqual([]);
  });

  it("should_stop_at_the_snippet_budget_and_report_the_skipped_books", async () => {
    const c = clock();
    // each book costs 4 s — the slowest single book measured on the real library
    const ftsSnippets = vi.fn(async (_q: string, _l: unknown, ids: number[]) => {
      c.advance(4_000);
      return new Map([[ids[0]!, ["s"]]]);
    });
    const fts = new FullTextSearch({ ftsSearch: vi.fn(), ftsSnippets }, c.now);
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    const batch = await fts.snippets("q", LIB, ids, { deadline: new Deadline(45_000, c.now) });
    expect(batch.byBook.size).toBe(5); // 5 × 4 s = the 20 s budget
    expect(batch.skipped).toEqual(ids.slice(5));
    expect(batch.stoppedBy).toBe("budget");
  });

  it("should_return_what_it_has_when_a_snippet_request_times_out", async () => {
    const c = clock();
    const ftsSnippets = vi
      .fn()
      .mockResolvedValueOnce(new Map([[1, ["s1"]]]))
      .mockRejectedValueOnce(new CalibreHttpTimeoutError("http://x/fts/snippets/2"));
    const fts = new FullTextSearch({ ftsSearch: vi.fn(), ftsSnippets }, c.now);
    const batch = await fts.snippets("q", LIB, [1, 2, 3], { deadline: new Deadline(45_000, c.now) });
    expect(batch).toEqual({ byBook: new Map([[1, ["s1"]]]), skipped: [2, 3], stoppedBy: "timeout" });
  });
});
