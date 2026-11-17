// #618: a refresh that changes nothing (a neighbour's close() checkpoint moves data_version but no
// book stamp) must keep the old matrix itself, not copy a library-sized Float32Array to no end.

import { describe, expect, it } from "vitest";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { MatrixWriter, mergeMatrix } from "../../src/semantic/store/chunk-matrix.js";

const empty = () => new MatrixWriter(new Map()).finish();

function oneBook(bookId: number) {
  const w = new MatrixWriter(new Map([[bookId, 1]]));
  w.place(bookId, 1, new Float32Array(EMBED_DIM).fill(0.5));
  return w.finish();
}

describe("mergeMatrix reuse (#618)", () => {
  it("no stale book and nothing fresh: returns the old matrix itself", () => {
    const old = oneBook(3);
    expect(mergeMatrix(old, new Set(), empty())).toBe(old);
  });

  it("stale ids the matrix never held and nothing fresh: returns the old matrix itself", () => {
    const old = oneBook(3);
    expect(mergeMatrix(old, new Set([8, 9]), empty())).toBe(old);
  });

  it("a stale book it holds: builds a new matrix without it", () => {
    const old = oneBook(3);
    expect(mergeMatrix(old, new Set([3]), empty()).chunkIds).toStrictEqual(new Int32Array(0));
  });
});
