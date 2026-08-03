// Mandatory property tests for the #93 filter layer (declared in test/eval/retrieval/
// thresholds.json BEFORE implementation, D-012): a restricted library search must return
// exactly the unfiltered ranking intersected with the allow set, order preserved — the
// formal reason the filter needs no new gated eval kind (brute-force ranking is exact).

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Test_Lib";

function store(): SqliteIndexStore {
  return new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
}

/** Vector with a dominant axis plus a smidge of axis 0, so every book scores > 0. */
function vec(i: number, weight = 1): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 0.1;
  v[i] = weight;
  return l2normalize(v);
}

function chunk(body: string, v: Float32Array): IndexedChunk {
  return { body, charStart: 0, charEnd: body.length, vector: v };
}

/** Four books with distinct axes → a deterministic unfiltered ranking for a query. */
function seeded(): SqliteIndexStore {
  const s = store();
  for (const id of [1, 2, 3, 4]) {
    s.replaceBook(LIB, { bookId: id, title: `Book ${id}`, authors: ["A"] }, [
      chunk(`common shared prose plus axis${id} term`, vec(id)),
    ]);
  }
  return s;
}

describe("store restriction properties (#93)", () => {
  it("searchLibrary restricted = unfiltered ∩ allow, order preserved", () => {
    const s = seeded();
    const q = vec(2, 0.5); // leans to book 2, others still score via the shared axis 0
    const unfiltered = s.searchLibrary(LIB, q, 10).map((h) => h.bookId);
    expect(unfiltered).toHaveLength(4);

    const allow = new Set([1, 3, 4]);
    const restricted = s.searchLibrary(LIB, q, 10, allow).map((h) => h.bookId);
    expect(restricted).toEqual(unfiltered.filter((id) => allow.has(id)));
    s.close();
  });

  it("searchLibrary with an empty allow set returns nothing (empty bundle scope)", () => {
    const s = seeded();
    expect(s.searchLibrary(LIB, vec(1), 10, new Set<number>())).toEqual([]);
    s.close();
  });

  it("searchLibraryFts restricted = unfiltered ∩ allow, order preserved", () => {
    const s = seeded();
    const unfiltered = s.searchLibraryFts(LIB, "common shared prose", 10).map((h) => h.bookId);
    expect(unfiltered).toHaveLength(4);

    const allow = new Set([2, 4]);
    const restricted = s.searchLibraryFts(LIB, "common shared prose", 10, allow).map((h) => h.bookId);
    expect(restricted).toEqual(unfiltered.filter((id) => allow.has(id)));
    s.close();
  });

  it("a small bundle is not starved by the FTS pool cap (filter lives in SQL)", () => {
    const s = store();
    // 30 decoy books rank ahead by repetition; the one allowed book must still surface.
    for (let id = 1; id <= 30; id++) {
      s.replaceBook(LIB, { bookId: id, title: `Decoy ${id}`, authors: [] }, [
        chunk("needle needle needle needle", vec(1)),
      ]);
    }
    s.replaceBook(LIB, { bookId: 99, title: "Wanted", authors: [] }, [chunk("needle once", vec(2))]);
    const hits = s.searchLibraryFts(LIB, "needle", 5, new Set([99]));
    expect(hits.map((h) => h.bookId)).toEqual([99]);
    s.close();
  });
});
