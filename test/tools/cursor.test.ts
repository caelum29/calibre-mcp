import { describe, it, expect } from "vitest";
import { decodeCursor, encodeCursor, pageCursor } from "../../src/tools/cursor.js";

describe("cursor codec", () => {
  it("round-trips a cursor", () => {
    const c = { offset: 40, libId: "Lib", mode: "search:meta", query: "rust", sort: "title" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("returns undefined for garbage", () => {
    expect(decodeCursor("not-a-cursor")).toBeUndefined();
  });
  it("returns undefined when missing", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
  });
  it("rejects a negative offset", () => {
    const bad = Buffer.from(JSON.stringify({ v: 2, offset: -1, libId: "Lib", mode: "m", query: "x" }), "utf8").toString(
      "base64url",
    );
    expect(decodeCursor(bad)).toBeUndefined();
  });
});

// #227 — an empty page must never mint a cursor back to the same offset (a paging loop)
describe("pageCursor on an empty page", () => {
  it("returns no cursor when nothing was fetched even though the total is larger", () => {
    expect(pageCursor({ offset: 2, fetched: 0, total: 5, libId: "Lib", mode: "m", query: "q" })).toEqual({
      nextCursor: undefined,
      textLine: "",
    });
  });
});
