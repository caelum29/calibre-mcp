// #93 filter layer: resolveFilter/buildScopedQuery semantics + the calibre_search wiring
// (expression expansion, FTS id-set restriction, honesty lines, unknown-filter affordance).

import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { Book } from "../../src/domain/book.js";
import type { SearchPage } from "../../src/domain/search.js";
import { log, type LogSink } from "../../src/logging.js";

// Typed as the narrow sink ToolDeps expects (an annotation, not a cast).
const sink: LogSink = log;
import { buildScopedQuery, invalidateBundleCache, resolveFilter, scopeExpression } from "../../src/app/bundles.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import { fakeFts, type FakeFtsHit } from "./fake-fts.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { SearchDeps, SearchIndex } from "../../src/tools/calibre_search.js";

const SAVED_SEARCHES = `Integration status: False
Name: Rust
Search string: tags:"=Rust"
Name: -noise
Search string: tags:"=Noise"
`;

const book = (id: number): Book => ({
  id,
  uuid: `u-${id}`,
  title: `Book ${id}`,
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
});

interface FakeOpts {
  /** query → SearchPage; the LAST entry is the fallback. Captures every query received. */
  pages?: Array<{ match?: (q: string) => boolean; page: Partial<SearchPage> }>;
  ftsHits?: FakeFtsHit[];
  savedSearches?: string;
  vls?: Record<string, string>;
}

function fake(opts: FakeOpts = {}) {
  const queries: string[] = [];
  const content = {
    search: async (p: { query: string; num?: number }): Promise<SearchPage> => {
      queries.push(p.query);
      const hit = opts.pages?.find((e) => e.match?.(p.query));
      const over = hit?.page ?? opts.pages?.at(-1)?.page ?? {};
      const bookIds = over.bookIds ?? [1, 2];
      return { bookIds, total: bookIds.length, num: bookIds.length, offset: 0, sort: "title", libraryId: "L", ...over };
    },
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)])),
    resolveLibraryId: async (display?: string) => display || "Test_Lib",
    virtualLibraries: async () => opts.vls ?? {},
  };
  const calibre = {
    calibredb: async () => ({ stdout: opts.savedSearches ?? SAVED_SEARCHES, stderr: "" }),
  };
  const index: SearchIndex = { hasIndex: () => false, isBookIndexed: () => false };
  const deps = {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: calibre as unknown as ToolDeps["calibre"],
    fts: fakeFts(opts.ftsHits),
    extractor: {} as ToolDeps["extractor"],
    index,
    log: sink,
  } as SearchDeps;
  return { deps, queries };
}

beforeEach(() => invalidateBundleCache());

describe("resolveFilter", () => {
  it("resolves a bundle and collects exclusion markers", async () => {
    const { deps } = fake();
    const r = await resolveFilter(deps, { filter: "Rust", autoExclude: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.res.bundle?.expression).toBe('tags:"=Rust"');
    expect(r.res.markers.map((m) => m.name)).toEqual(["-noise"]);
  });

  it("unknown filter errors with the available bundle names", async () => {
    const { deps } = fake();
    const r = await resolveFilter(deps, { filter: "Golang", autoExclude: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Rust, -noise");
  });

  it("a marker used as the filter disables auto-exclusion for the call", async () => {
    const { deps } = fake();
    const r = await resolveFilter(deps, { filter: "-noise", autoExclude: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.res.bundle?.name).toBe("-noise");
    expect(r.res.markers).toEqual([]);
  });

  it("include_excluded opts out of marker subtraction", async () => {
    const { deps } = fake();
    const r = await resolveFilter(deps, { filter: "Rust", includeExcluded: true, autoExclude: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.res.markers).toEqual([]);
  });

  it("saved search wins a name collision with a virtual library, with a note", async () => {
    const { deps } = fake({ vls: { Rust: "tags:Golang" } });
    const r = await resolveFilter(deps, { filter: "Rust", autoExclude: false });
    if (!r.ok) throw new Error(r.error);
    expect(r.res.bundle?.kind).toBe("saved_search");
    expect(r.res.collisionNote).toContain("saved search");
  });

  it("no filter + no calibredb wired = exclusion sweep off, no note", async () => {
    const { deps } = fake();
    (deps as { calibre: unknown }).calibre = {};
    const r = await resolveFilter(deps, { autoExclude: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.res.markers).toEqual([]);
    expect(r.res.degradeNote).toBeUndefined();
  });

  it("a failing bundle listing degrades the sweep with a note but errors an explicit filter", async () => {
    const { deps } = fake();
    (deps.calibre as { calibredb: unknown }).calibredb = async () => {
      throw new Error("boom");
    };
    const sweep = await resolveFilter(deps, { autoExclude: true });
    if (!sweep.ok) throw new Error(sweep.error);
    expect(sweep.res.degradeNote).toContain("exclusion check unavailable");

    const explicit = await resolveFilter(deps, { filter: "Rust", autoExclude: true });
    expect(explicit.ok).toBe(false);
  });
});

describe("buildScopedQuery", () => {
  it("composes query, bundle expression, and marker subtraction", async () => {
    const { deps } = fake();
    const r = await resolveFilter(deps, { filter: "Rust", autoExclude: true });
    if (!r.ok) throw new Error(r.error);
    expect(buildScopedQuery("async", r.res)).toBe('(async) and (tags:"=Rust") and not search:"=-noise"');
    expect(scopeExpression(r.res)).toBe('(tags:"=Rust") and not search:"=-noise"');
  });

  it("returns the base query untouched when nothing resolved", () => {
    expect(buildScopedQuery("async", { markers: [] })).toBe("async");
    expect(buildScopedQuery("", { markers: [] })).toBe("");
  });
});

describe("calibre_search + filter", () => {
  it("meta search expands the filter into the server query and reports honesty lines", async () => {
    const { deps, queries } = fake();
    const r = await searchTool.handler(
      { query: "async", mode: "meta", scope: "library", limit: 20, filter: "Rust" },
      deps,
    );
    expect(r.isError).toBeFalsy();
    expect(queries.some((q) => q === '(async) and (tags:"=Rust") and not search:"=-noise"')).toBe(true);
    const text = r.content.find((c) => c.type === "text");
    expect(text && "text" in text ? text.text : "").toContain("filter: Rust");
    expect(text && "text" in text ? text.text : "").toContain("exclusions applied: [-noise]");
    expect(r.structuredContent).toMatchObject({ filter: "Rust", exclusionsApplied: ["-noise"] });
  });

  it("auto-exclusion applies with no filter, and include_excluded disables it", async () => {
    const { deps, queries } = fake();
    await searchTool.handler({ query: "async", mode: "meta", scope: "library", limit: 20 }, deps);
    expect(queries.some((q) => q === '(async) and not search:"=-noise"')).toBe(true);

    const { deps: deps2, queries: queries2 } = fake();
    await searchTool.handler(
      { query: "async", mode: "meta", scope: "library", limit: 20, include_excluded: true },
      deps2,
    );
    expect(queries2).toContain("async");
  });

  it("fts search restricts grouped hits to the bundle's book-id set", async () => {
    const hit = (bookId: number): FakeFtsHit => ({ bookId, snippet: `s${bookId}` });
    const { deps } = fake({
      ftsHits: [hit(1), hit(2), hit(3)],
      pages: [{ page: { bookIds: [1, 3] } }], // the scope-expression id set
    });
    const r = await searchTool.handler(
      { query: "needle", mode: "fts", scope: "library", limit: 20, filter: "Rust" },
      deps,
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.bookIds).toEqual([1, 3]);
  });

  it("unknown filter returns the discovery-affordance error", async () => {
    const { deps } = fake();
    const r = await searchTool.handler(
      { query: "x", mode: "meta", scope: "library", limit: 20, filter: "Golang" },
      deps,
    );
    expect(r.isError).toBe(true);
    const text = r.content.find((c) => c.type === "text");
    expect(text && "text" in text ? text.text : "").toContain("Rust, -noise");
  });

  it("filter is rejected for scope=book", async () => {
    const { deps } = fake();
    const r = await searchTool.handler(
      { query: "x", mode: "fts", scope: "book", bookId: 1, limit: 20, filter: "Rust" },
      deps,
    );
    expect(r.isError).toBe(true);
  });
});

// #564: exclusion markers stay global and also cut an explicit filter — the note must say how
// many books they removed, so "filter: Rust (0 books)" never reads as an empty bundle.
describe("exclusion count on an explicit filter (#564)", () => {
  const REMOVED_Q = '(tags:"=Rust") and (search:"=-noise")';
  const pages = [{ match: (q: string) => q === REMOVED_Q, page: { bookIds: [7, 8, 9] } }, { page: { bookIds: [] } }];

  it("resolveFilter counts the bundle books the markers remove", async () => {
    const { deps, queries } = fake({ pages });
    const r = await resolveFilter(deps, { filter: "Rust", autoExclude: true });
    if (!r.ok) throw new Error(r.error);
    expect(queries).toContain(REMOVED_Q);
    expect(r.res.excludedBooks).toBe(3);
  });

  it("no extra count without a filter or with include_excluded", async () => {
    const { deps } = fake({ pages });
    const a = await resolveFilter(deps, { autoExclude: true });
    const b = await resolveFilter(deps, { filter: "Rust", includeExcluded: true, autoExclude: true });
    if (!a.ok || !b.ok) throw new Error("resolve failed");
    expect(a.res.excludedBooks).toBeUndefined();
    expect(b.res.excludedBooks).toBeUndefined();
  });

  it("calibre_search reports the removed count in text AND structuredContent", async () => {
    const { deps } = fake({ pages });
    const r = await searchTool.handler(
      { query: "async", mode: "meta", scope: "library", limit: 20, filter: "Rust" },
      deps,
    );
    const text = r.content.find((c) => c.type === "text");
    const t = text && "text" in text ? text.text : "";
    expect(t).toContain("filter: Rust (0 books)");
    expect(t).toContain("exclusions applied: [-noise] removed 3 books from the filter");
    expect(r.structuredContent).toMatchObject({ exclusionsApplied: ["-noise"], exclusionsRemoved: 3 });
  });
});
