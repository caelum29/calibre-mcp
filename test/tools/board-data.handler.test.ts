import { describe, it, expect } from "vitest";
import { z } from "zod";
import { boardDataTool } from "../../src/tools/calibre_board_data.js";
import { BoardCache, type BoardPayload } from "../../src/ui/board-cache.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/types.js";

const payload: BoardPayload = {
  tool: "calibre_search",
  query: "rust",
  kind: "keyword",
  libraryId: "Programming_Books",
  serverUrl: "http://localhost:8080",
  books: [{ bookId: 1, title: "Book 1", authors: ["A"] }],
};

// Fake Content Server library map: display name → libId; absent = the default library.
const LIBS: Record<string, string> = { Programming_Books: "Programming Books", Reaserch_Books: "Reaserch Books" };
const fakeContent = {
  resolveLibraryId: async (display?: string): Promise<string> => {
    if (display === undefined) return "Programming_Books";
    if (LIBS[display] !== undefined) return display;
    const hit = Object.entries(LIBS).find(([, name]) => name === display);
    if (!hit) throw new Error(`Unknown library "${display}"`);
    return hit[0];
  },
} as unknown as ToolDeps["content"];

function deps(cache?: BoardCache): ToolDeps {
  return {
    config: loadConfig({}),
    content: fakeContent,
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    boardCache: cache,
    log,
  };
}

describe("calibre_board_data handler", () => {
  it("should_return_cached_payload_as_structured_content", async () => {
    const cache = new BoardCache();
    cache.set(payload);
    const r = await boardDataTool.handler({ tool: "calibre_search", query: "rust" }, deps(cache));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ query: "rust", libraryId: "Programming_Books" });
  });

  it("should_error_on_cache_miss", async () => {
    const r = await boardDataTool.handler({ tool: "calibre_search", query: "zzz" }, deps(new BoardCache()));
    expect(r.isError).toBe(true);
  });

  it("should_error_when_cache_not_wired", async () => {
    const r = await boardDataTool.handler({}, deps(undefined));
    expect(r.isError).toBe(true);
  });
});

// #215 — the widget passes its tool-input library/filter back; the board must show THAT
// search, not a same-query search run later in another library or under another bundle.
describe("calibre_board_data handler — library/filter scoping (#215)", () => {
  const titled = (title: string, over: Partial<BoardPayload> = {}): BoardPayload => ({
    ...payload,
    books: [{ bookId: 7, title, authors: ["X"] }],
    ...over,
  });
  const firstTitle = (r: Awaited<ReturnType<typeof boardDataTool.handler>>): unknown =>
    (r.structuredContent as { books?: Array<{ title: string }> } | undefined)?.books?.[0]?.title;

  function twoLibraries(): BoardCache {
    const cache = new BoardCache();
    cache.set(titled("from-prog", { libraryId: "Programming_Books" }));
    cache.set(titled("from-research", { libraryId: "Reaserch_Books" }));
    return cache;
  }

  function twoFilters(): BoardCache {
    const cache = new BoardCache();
    cache.set(titled("unfiltered"));
    cache.set(titled("systems", { filter: "Systems" }));
    cache.set(titled("web", { filter: "Web" }));
    return cache;
  }

  it("should_return_research_board_when_library_given_by_display_name", async () => {
    const r = await boardDataTool.handler(
      { tool: "calibre_search", query: "rust", library: "Reaserch Books" },
      deps(twoLibraries()),
    );
    expect(firstTitle(r)).toBe("from-research");
  });

  it("should_return_research_board_when_library_given_by_lib_id", async () => {
    const r = await boardDataTool.handler(
      { tool: "calibre_search", query: "rust", library: "Reaserch_Books" },
      deps(twoLibraries()),
    );
    expect(firstTitle(r)).toBe("from-research");
  });

  it("should_return_default_library_board_when_library_missing_though_other_library_ran_later", async () => {
    const r = await boardDataTool.handler({ tool: "calibre_search", query: "rust" }, deps(twoLibraries()));
    expect(firstTitle(r)).toBe("from-prog");
  });

  it("should_return_board_of_the_requested_filter", async () => {
    const r = await boardDataTool.handler(
      { tool: "calibre_search", query: "rust", filter: "Systems" },
      deps(twoFilters()),
    );
    expect(firstTitle(r)).toBe("systems");
  });

  it("should_return_unfiltered_board_when_filter_missing_though_filtered_runs_are_newer", async () => {
    const r = await boardDataTool.handler({ tool: "calibre_search", query: "rust" }, deps(twoFilters()));
    expect(firstTitle(r)).toBe("unfiltered");
  });

  it("should_miss_for_legacy_request_when_only_a_filtered_run_is_cached", async () => {
    // older widgets send no library/filter → read as default library, unfiltered: a miss
    // (the widget re-runs its search) beats rendering another search's books
    const cache = new BoardCache();
    cache.set(titled("systems", { filter: "Systems" }));
    const r = await boardDataTool.handler({ tool: "calibre_search", query: "rust" }, deps(cache));
    expect(r.isError).toBe(true);
  });

  it("should_miss_when_requested_library_never_ran_the_query", async () => {
    const cache = new BoardCache();
    cache.set(titled("from-prog"));
    const r = await boardDataTool.handler(
      { tool: "calibre_search", query: "rust", library: "Reaserch Books" },
      deps(cache),
    );
    expect(r.isError).toBe(true);
  });

  it("should_return_error_naming_the_library_when_it_cannot_be_resolved", async () => {
    const cache = new BoardCache();
    cache.set(titled("from-prog"));
    const r = await boardDataTool.handler({ tool: "calibre_search", query: "rust", library: "Nope" }, deps(cache));
    expect(r.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Nope") });
  });

  it("should_accept_library_and_filter_in_input_schema_trimming_the_filter", () => {
    const parsed = z.object(boardDataTool.inputSchema).parse({
      tool: "calibre_search",
      query: "rust",
      library: "Reaserch Books",
      filter: " Systems ",
    });
    expect(parsed).toEqual({ tool: "calibre_search", query: "rust", library: "Reaserch Books", filter: "Systems" });
  });
});
