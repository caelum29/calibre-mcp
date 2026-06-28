import { describe, it, expect } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/tools/cursor.js";

describe("cursor codec", () => {
  it("round-trips a cursor", () => {
    const c = { offset: 40, query: "rust", sort: "title" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("returns undefined for garbage", () => {
    expect(decodeCursor("not-a-cursor")).toBeUndefined();
  });
  it("returns undefined when missing", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
  });
  it("rejects a negative offset", () => {
    const bad = Buffer.from(JSON.stringify({ offset: -1, query: "x" }), "utf8").toString("base64url");
    expect(decodeCursor(bad)).toBeUndefined();
  });
});
