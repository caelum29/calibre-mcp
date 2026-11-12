// #579: books removed or merged in the Calibre GUI must not come back from calibre_semantic_search.
// The search checks its hits' ids against the library (one Content Server request), drops the gone
// ones and prunes them from the index best-effort; a slow or failing check keeps today's hits.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { SearchPage, SearchParams } from "../../src/calibre/content-server.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { semanticSearchTool, type SemanticDeps } from "../../src/tools/calibre_semantic_search.js";
import type { ToolResult } from "../../src/tools/types.js";
import { fakeCalibre, fakeContent, fakeExtractor, fakeFigures } from "./fake-ports.js";

const LIB = "Programming_Books";

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

const embedder: Embedder = {
  async embedQuery() {
    return axis(0);
  },
  async embedPassages(texts) {
    return texts.map(() => axis(0));
  },
  async warmup() {},
  countTokens: (s) => s.length,
};

/** Books 1 and 2, both matching "ownership", each with one figure caption. */
function store(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  for (const id of [1, 2])
    s.replaceBook(
      LIB,
      { bookId: id, title: `Book ${id}`, authors: ["A"] },
      [{ charStart: 0, charEnd: 40, body: `ownership rules of book ${id}`, vector: axis(0) }],
      [
        {
          figIndex: 0,
          page: 3,
          caption: "Figure 1-1. Ownership diagram",
          charOffset: 5,
          format: "pdf",
          vector: axis(0),
        },
      ],
    );
  return s;
}

/** A library holding `live`: answers our `id:=a or id:=b` check with the live subset. */
function liveSearch(live: readonly number[], calls: SearchParams[] = []) {
  return async (p: SearchParams): Promise<SearchPage> => {
    calls.push(p);
    const asked = [...p.query.matchAll(/id:=(\d+)/g)].map((m) => Number(m[1]));
    const bookIds = asked.filter((id) => live.includes(id));
    return { bookIds, total: bookIds.length, num: bookIds.length, offset: 0, sort: "title", libraryId: LIB };
  };
}

function deps(index: SqliteIndexStore, search: (p: SearchParams) => Promise<SearchPage>): SemanticDeps {
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: fakeContent({
      virtualLibraries: async () => ({}),
      resolveLibraryId: async () => asLibId(LIB),
      search,
    }),
    calibre: fakeCalibre({ calibredb: async () => ({ stdout: "", stderr: "" }) }),
    extractor: fakeExtractor(),
    figures: fakeFigures(),
    embedder,
    index,
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({
  query: "ownership",
  scope: "library" as const,
  target: "text" as const,
  mode: "hybrid" as const,
  topK: 10,
  ...over,
});

const text = (r: ToolResult) =>
  r.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");

describe("calibre_semantic_search drops books the library no longer holds (#579)", () => {
  it.each(["hybrid", "vector", "keyword"] as const)(
    "should_drop_a_gui_removed_book_from_library_text_hits_in_%s_mode",
    async (mode) => {
      const index = store();
      const r = await semanticSearchTool.handler(args({ mode }), deps(index, liveSearch([1])));
      expect(r.isError).toBeUndefined();
      expect(r.structuredContent?.bookIds).toEqual([1]);
      expect(r.structuredContent?.count).toBe(1);
      const results = r.structuredContent?.results as Array<{ bookId: number }>;
      expect(results.map((x) => x.bookId)).toEqual([1]);
      expect(text(r)).not.toContain("book 2");
      expect(text(r)).toContain("Top 1 book(s)");
    },
  );

  it("should_prune_the_gone_book_from_the_index_best_effort", async () => {
    const index = store();
    await semanticSearchTool.handler(args(), deps(index, liveSearch([1])));
    expect(index.isBookIndexed(LIB, 2)).toBe(false);
    expect(index.isBookIndexed(LIB, 1)).toBe(true);
  });

  it("should_check_the_hit_ids_in_one_request_without_the_busy_breaker", async () => {
    const calls: SearchParams[] = [];
    await semanticSearchTool.handler(args(), deps(store(), liveSearch([1, 2], calls)));
    const checks = calls.filter((c) => c.query.includes("id:="));
    expect(checks).toHaveLength(1);
    expect(checks[0]!.query).toBe("id:=1 or id:=2");
    expect(checks[0]!.noBreaker).toBe(true);
    expect(checks[0]!.timeoutMs).toBeGreaterThan(0);
  });

  it("should_say_no_matches_when_every_hit_is_gone", async () => {
    const r = await semanticSearchTool.handler(args(), deps(store(), liveSearch([])));
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.count).toBe(0);
    expect(text(r)).toContain('No matches for "ownership"');
  });

  it.each(["library", "book"] as const)("should_drop_gone_books_from_figure_hits_at_%s_scope", async (scope) => {
    const r = await semanticSearchTool.handler(
      args({ target: "figures", scope, ...(scope === "book" ? { bookId: 1 } : {}) }),
      deps(store(), liveSearch([1])),
    );
    expect(r.isError).toBeUndefined();
    const figs = r.structuredContent?.figures as Array<{ bookId: number }>;
    expect(figs.map((f) => f.bookId)).toEqual([1]);
    expect(text(r)).not.toContain("book 2");
  });

  it("should_drop_every_figure_hit_of_a_gone_book_at_library_scope", async () => {
    const r = await semanticSearchTool.handler(args({ target: "figures" }), deps(store(), liveSearch([2])));
    const figs = r.structuredContent?.figures as Array<{ bookId: number }>;
    expect(figs.map((f) => f.bookId)).toEqual([2]);
  });

  it.each(["text", "figures"] as const)("should_answer_not_found_for_a_gone_book_at_book_scope_%s", async (target) => {
    const index = store();
    const r = await semanticSearchTool.handler(
      args({ scope: "book", bookId: 2, target }),
      deps(index, liveSearch([1])),
    );
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.code).toBe("not_found");
    expect(text(r)).toContain("2");
    expect(index.isBookIndexed(LIB, 2)).toBe(false);
  });

  it("should_keep_book_scope_working_for_a_live_book", async () => {
    const r = await semanticSearchTool.handler(args({ scope: "book", bookId: 1 }), deps(store(), liveSearch([1])));
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.count).toBe(1);
  });
});

describe("a slow or failing existence check keeps today's hits (#579)", () => {
  const failing = async (p: SearchParams): Promise<SearchPage> => {
    if (p.query.includes("id:=")) throw new Error("ECONNREFUSED");
    return liveSearch([])(p);
  };
  const hanging = (p: SearchParams): Promise<SearchPage> =>
    p.query.includes("id:=") ? new Promise(() => {}) : liveSearch([])(p);
  const malformed = async (p: SearchParams): Promise<SearchPage> => {
    if (!p.query.includes("id:=")) return liveSearch([])(p);
    // an id we never asked about: not an answer to our question
    return { bookIds: [99], total: 1, num: 1, offset: 0, sort: "title", libraryId: LIB };
  };
  const noArray = async (p: SearchParams): Promise<SearchPage> => {
    if (!p.query.includes("id:=")) return liveSearch([])(p);
    return { total: 0, num: 0, offset: 0, sort: "title", libraryId: LIB } as unknown as SearchPage;
  };

  it.each([
    ["fails", failing],
    ["answers with an id it was not asked about", malformed],
    ["answers with no id list", noArray],
  ] as const)("should_keep_every_hit_when_the_check_%s", async (_why, search) => {
    const index = store();
    const r = await semanticSearchTool.handler(args(), deps(index, search));
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.bookIds).toEqual([1, 2]);
    expect(index.isBookIndexed(LIB, 2)).toBe(true);
  });

  it("should_not_stall_when_the_check_hangs", async () => {
    const started = Date.now();
    const r = await semanticSearchTool.handler(args(), deps(store(), hanging));
    expect(Date.now() - started).toBeLessThan(2500);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.bookIds).toEqual([1, 2]);
  });

  it("should_keep_a_book_scope_search_when_the_check_fails", async () => {
    const r = await semanticSearchTool.handler(args({ scope: "book", bookId: 2 }), deps(store(), failing));
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.count).toBe(1);
  });

  it("should_still_drop_the_hit_when_the_prune_is_refused", async () => {
    const index = store();
    const busy = new Proxy(index, {
      get(target, prop, recv) {
        if (prop === "deleteBooks")
          return () => {
            throw Object.assign(new Error("database is locked"), { errcode: 5 });
          };
        const v = Reflect.get(target, prop, recv) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const r = await semanticSearchTool.handler(args(), deps(busy, liveSearch([1])));
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.bookIds).toEqual([1]);
    // the prune is ours to retry on the next search; the model gets no note about it
    expect(text(r)).not.toContain("Semantic index not updated");
  });
});
