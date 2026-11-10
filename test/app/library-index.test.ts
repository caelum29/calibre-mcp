// Ping's per-library index report as a use case (#346): per-library states, the shared 5 s
// budget, and the no-breaker count — on narrow fakes, without the ping tool around it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryIndexReport, type LibraryIndexDeps } from "../../src/app/library-index.js";
import type { SearchParams } from "../../src/domain/search.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";

const META = { modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION };
const MAP = { A: "Alpha", B: "Beta", C: "Gamma", D: "Delta" };

interface Over {
  libraryInfo?: LibraryIndexDeps["content"]["libraryInfo"];
  search?: (p: SearchParams) => Promise<{ total: number }>;
}

function deps(o: Over = {}, searches: SearchParams[] = []): LibraryIndexDeps {
  return {
    content: {
      libraryInfo: o.libraryInfo ?? (async () => ({ libraryMap: MAP, defaultLibrary: "A" })),
      search: async (p) => {
        searches.push(p);
        const r = await (o.search ?? (async () => ({ total: 50 })))(p);
        return { bookIds: [], num: 0, offset: 0, sort: "", libraryId: p.library ?? "A", ...r };
      },
    },
    index: {
      // A: ok, B: no index, C: stale, D: store throws
      hasIndex: (id) => id !== "B",
      indexMeta: (id) => (id === "C" ? { ...META, indexVersion: INDEX_VERSION - 1 } : META),
      stats: (id) => {
        if (id === "D") throw new Error("SQLITE_CORRUPT");
        return { books: 40, chunks: 400, figures: 0 };
      },
      booksMissingVectors: () => 3,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("libraryIndexReport (#346)", () => {
  it("reports each library's state on its own, counting via the no-breaker path", async () => {
    const searches: SearchParams[] = [];
    expect(await libraryIndexReport(deps({}, searches))).toEqual([
      { id: "A", name: "Alpha", isDefault: true, state: "ok", indexed: 40, total: 50, withoutEmbeddings: 3 },
      { id: "B", name: "Beta", isDefault: false, state: "none" },
      { id: "C", name: "Gamma", isDefault: false, state: "stale" },
      { id: "D", name: "Delta", isDefault: false, state: "unreadable" },
    ]);
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({ query: "", library: "A", num: 0, noBreaker: true });
  });

  it("returns undefined when the library list is unavailable", async () => {
    const failing = deps({
      libraryInfo: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await libraryIndexReport(failing)).toBeUndefined();
  });

  it("a count that errors reports total null, not a failure", async () => {
    const out = await libraryIndexReport(deps({ search: async () => Promise.reject(new Error("timeout")) }));
    expect(out?.[0]).toEqual({
      id: "A",
      name: "Alpha",
      isDefault: true,
      state: "ok",
      indexed: 40,
      total: null,
      withoutEmbeddings: 3,
    });
  });

  it("one 5 s budget covers libraryInfo and the counts", async () => {
    vi.useFakeTimers();
    const searches: SearchParams[] = [];
    const slowInfo = deps(
      {
        libraryInfo: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ libraryMap: { A: "Alpha" }, defaultLibrary: "A" }), 3000),
          ),
        search: () => new Promise(() => {}),
      },
      searches,
    );
    let settled: unknown = "pending";
    void libraryIndexReport(slowInfo).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(3000);
    expect(searches[0]?.timeoutMs).toBe(2000); // what the slow libraryInfo left
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual([
      { id: "A", name: "Alpha", isDefault: true, state: "ok", indexed: 40, total: null, withoutEmbeddings: 3 },
    ]);
  });

  it("gives up on a hanging libraryInfo at exactly the 5 s budget, not before", async () => {
    vi.useFakeTimers();
    const searches: SearchParams[] = [];
    let settled: unknown = "pending";
    void libraryIndexReport(deps({ libraryInfo: () => new Promise(() => {}) }, searches)).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect([settled, searches]).toEqual([undefined, []]); // no map → no counts were attempted
  });

  it("a count started with the budget nearly spent is still cut off at 5 s with total null", async () => {
    vi.useFakeTimers();
    const searches: SearchParams[] = [];
    const lateInfo = deps(
      {
        libraryInfo: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ libraryMap: { A: "Alpha" }, defaultLibrary: "A" }), 4900),
          ),
        search: () => new Promise(() => {}),
      },
      searches,
    );
    let settled: unknown = "pending";
    void libraryIndexReport(lateInfo).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(4900);
    expect(searches[0]?.timeoutMs).toBe(100);
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual([
      { id: "A", name: "Alpha", isDefault: true, state: "ok", indexed: 40, total: null, withoutEmbeddings: 3 },
    ]);
  });
});
