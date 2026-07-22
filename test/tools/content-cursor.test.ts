import { describe, it, expect } from "vitest";
import { decodeContentCursor, encodeContentCursor } from "../../src/tools/content-cursor.js";

describe("content cursor codec", () => {
  it("round-trips a cursor", () => {
    const c = { offset: 8000, id: 658, format: "pdf" };
    expect(decodeContentCursor(encodeContentCursor(c))).toEqual(c);
  });
  it("returns undefined for garbage", () => {
    expect(decodeContentCursor("not-a-cursor")).toBeUndefined();
  });
  it("returns undefined when missing", () => {
    expect(decodeContentCursor(undefined)).toBeUndefined();
  });
  it("rejects a negative offset", () => {
    const bad = Buffer.from(JSON.stringify({ offset: -1, id: 1, format: "pdf" }), "utf8").toString("base64url");
    expect(decodeContentCursor(bad)).toBeUndefined();
  });
  it("rejects a missing id", () => {
    const bad = Buffer.from(JSON.stringify({ v: 2, offset: 0, format: "pdf" }), "utf8").toString("base64url");
    expect(decodeContentCursor(bad)).toBeUndefined();
  });
  it("rejects a pre-marker v1 cursor (no version field) — offsets drifted (#84)", () => {
    const v1 = Buffer.from(JSON.stringify({ offset: 8000, id: 658, format: "pdf" }), "utf8").toString("base64url");
    expect(decodeContentCursor(v1)).toBeUndefined();
  });
  it("rejects a wrong-version cursor", () => {
    const bad = Buffer.from(JSON.stringify({ v: 1, offset: 0, id: 1, format: "pdf" }), "utf8").toString("base64url");
    expect(decodeContentCursor(bad)).toBeUndefined();
  });
});
