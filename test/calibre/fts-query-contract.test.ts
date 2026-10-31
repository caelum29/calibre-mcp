// #325 (from #311): Calibre binds the FTS query unchanged into SQLite `MATCH ?`
// (db/fts/connect.py, calibre bb87130), so AND / OR / binary NOT must reach /fts/search
// byte-for-byte. Contract test from calibre_search down to the request URL, answered with a
// recorded /fts/search reply (fixtures/, Calibre 9.17); no live server.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/calibre/http.js", () => ({ getJson: vi.fn(), getBytes: vi.fn() }));
import { getJson } from "../../src/calibre/http.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { FullTextSearch } from "../../src/calibre/fts.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";

// Recorded: GET /fts/search?query=monomorphization&library_id=Programming_Books (first 3 rows).
const RECORDED = JSON.parse(
  readFileSync(new URL("./fixtures/fts-search.monomorphization.json", import.meta.url), "utf8"),
) as unknown;

const client = new ContentServerClient(loadConfig({ CALIBRE_MCP_SERVER_URL: "http://localhost:8080" }));

function deps(): ToolDeps {
  const content = { resolveLibraryId: async () => "Programming_Books" };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    fts: new FullTextSearch(client),
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false } as unknown as ToolDeps["index"],
    log,
  };
}

/** The `query` param of every /fts/search request the tool sent. */
function sentSearchQueries(): (string | null)[] {
  return vi
    .mocked(getJson)
    .mock.calls.map(([url]) => new URL(String(url)))
    .filter((u) => u.pathname === "/fts/search")
    .map((u) => u.searchParams.get("query"));
}

beforeEach(() => {
  vi.mocked(getJson).mockReset();
  vi.mocked(getJson).mockImplementation(async (url: unknown) =>
    new URL(String(url)).pathname === "/fts/search" ? RECORDED : { snippets: {} },
  );
});

describe("FTS query contract — boolean operators pass through (#325, #311)", () => {
  const queries = [
    "event AND sourcing",
    "kafka OR rabbitmq",
    "event NOT sourcing",
    "(calibre AND ebook) NOT gun",
    '"event sourcing" OR cqrs',
    "NEAR(event sourcing, 5)",
  ];
  for (const query of queries) {
    it(`should_send_${query}_to_fts_search_unchanged`, async () => {
      const r = await searchTool.handler({ query, mode: "fts", scope: "library", limit: 20 }, deps());
      expect(r.isError).toBeFalsy();
      expect(sentSearchQueries()).toEqual([query]);
    });
  }

  it("should_map_the_recorded_reply_for_a_boolean_query", async () => {
    const r = await searchTool.handler(
      { query: "monomorphization NOT generics", mode: "fts", scope: "library", limit: 20, countOnly: true },
      deps(),
    );
    const first = r.content[0];
    expect(first?.type === "text" && first.text).toBe(
      '3 books have full-text matches for "monomorphization NOT generics".',
    );
  });
});
