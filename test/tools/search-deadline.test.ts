// calibre_search under a stalled Calibre (2026-10-31 run): `saved_searches list` timed out at
// 30 s, then `fts_search` at 60 s — 90 s, past the client's 60 s. Every sub-call now shares one
// 45 s deadline, the bundle sweep degrades instead of blocking, and FTS-off fails fast.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FullTextSearch } from "../../src/calibre/fts.js";
import { loadConfig } from "../../src/config.js";
import { CalibreCliTimeoutError, CalibreHttpTimeoutError, FtsError } from "../../src/domain/errors.js";
import type { FtsMatches, SearchPage } from "../../src/domain/search.js";
import { log } from "../../src/logging.js";
import { invalidateBundleCache } from "../../src/tools/bundles.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";

/** A boundary call that hangs until its own timeout fires, like a request queued behind a held lock. */
const hangUntilTimeout = (err: () => Error) => (timeoutMs: number | undefined) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(err()), timeoutMs ?? 30_000));

const MATCHES: FtsMatches = {
  bookIds: [1235],
  books: new Map([
    [1235, { title: "Dependency Injection: Principles, Practices, Patterns", authors: ["Mark Seemann"] }],
  ]),
  indexing: { left: 0, total: 1136 },
};

interface Stalls {
  savedSearches?: boolean;
  fts?: "hang" | "disabled";
}

function deps(stall: Stalls): ToolDeps {
  const content = {
    resolveLibraryId: async () => "Programming_Books",
    search: async (): Promise<SearchPage> => ({
      bookIds: [],
      total: 0,
      num: 0,
      offset: 0,
      sort: "title",
      libraryId: "L",
    }),
    virtualLibraries: async () => ({}),
    ftsSearch: async (_q: string, libId: string, o: { timeoutMs?: number }) => {
      if (stall.fts === "disabled") throw new FtsError("FTS_DISABLED", libId);
      if (stall.fts === "hang")
        return hangUntilTimeout(() => new CalibreHttpTimeoutError("http://x/fts/search"))(o.timeoutMs);
      return MATCHES;
    },
    ftsSnippets: async (_q: string, _l: string, ids: number[]) =>
      new Map([[ids[0]!, ["…>>dependency<< >>injection<<…"]]]),
  };
  const calibre = {
    calibredb: async (_args: readonly string[], o: { timeoutMs?: number }) =>
      stall.savedSearches
        ? hangUntilTimeout(() => new CalibreCliTimeoutError("calibredb command timed out"))(o.timeoutMs)
        : { stdout: "Integration status: False\n", stderr: "" },
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: calibre as unknown as ToolDeps["calibre"],
    fts: new FullTextSearch(content as unknown as ConstructorParameters<typeof FullTextSearch>[0]),
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false } as unknown as ToolDeps["index"],
    log,
  };
}

const ARGS = { query: "dependency injection", mode: "fts", scope: "library", limit: 3 } as const;
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("\n");

/** Run the handler on fake time; returns the result and how long (fake ms) it took. */
async function timed(d: ToolDeps) {
  const start = Date.now();
  let endedAt = -1;
  const p = searchTool.handler(ARGS, d).then((r) => {
    endedAt = Date.now();
    return r;
  });
  await vi.advanceTimersByTimeAsync(120_000);
  return { r: await p, ms: endedAt - start };
}

beforeEach(() => {
  invalidateBundleCache();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("calibre_search deadline (2026-10-31 hang)", () => {
  it("should_answer_within_45s_when_both_saved_searches_and_fts_stall", async () => {
    const { r, ms } = await timed(deps({ savedSearches: true, fts: "hang" }));
    expect(ms).toBeLessThanOrEqual(45_000);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("45 s time budget");
  });

  it("should_still_search_when_saved_searches_times_out", async () => {
    const { r, ms } = await timed(deps({ savedSearches: true }));
    expect(r.isError).toBeFalsy();
    expect(ms).toBeLessThanOrEqual(5_000); // the exclusion sweep waits its short cold cap, not 30 s
    expect(textOf(r)).toContain("Found 1 books with full-text matches");
    expect(textOf(r)).toContain("exclusion check unavailable");
  });

  it("should_fail_fast_with_enable_steps_when_fts_is_disabled", async () => {
    const { r, ms } = await timed(deps({ fts: "disabled" }));
    expect(ms).toBe(0);
    expect(textOf(r)).toContain("Full-text search is not enabled");
  });

  it("should_note_an_incomplete_index_and_still_return_matches", async () => {
    const d = deps({});
    const content = d.content as unknown as { ftsSearch: () => Promise<FtsMatches> };
    content.ftsSearch = async () => ({ ...MATCHES, indexing: { left: 568, total: 1136 } });
    const { r } = await timed(d);
    expect(textOf(r)).toContain("FTS index 50% complete (568 of 1136 book files)");
    expect(r.structuredContent).toMatchObject({ total: 1, indexing: { left: 568, total: 1136 } });
  });
});
