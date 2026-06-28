import { describe, it, expect } from "vitest";
import { z } from "zod";
import { BookId, CoercedBool, CoercedInt, jsonArray, limitParam } from "../../src/tools/coerce.js";

describe("CoercedBool", () => {
  it("treats the string 'false' as false (the -32602 trap)", () => {
    expect(CoercedBool().parse("false")).toBe(false);
  });
  it("treats '1'/'true'/true as true", () => {
    expect(CoercedBool().parse("1")).toBe(true);
    expect(CoercedBool().parse("true")).toBe(true);
    expect(CoercedBool().parse(true)).toBe(true);
  });
});

describe("CoercedInt", () => {
  it("coerces a numeric string", () => {
    expect(CoercedInt().parse("42")).toBe(42);
  });
});

describe("BookId", () => {
  it("coerces a numeric id string to a number", () => {
    expect(BookId().parse("3")).toBe(3);
  });
  it("keeps a uuid string as a string", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(BookId().parse(uuid)).toBe(uuid);
  });
});

describe("jsonArray", () => {
  it("parses a JSON-string array", () => {
    expect(jsonArray(z.string()).parse('["a","b"]')).toEqual(["a", "b"]);
  });
  it("accepts a real array unchanged", () => {
    expect(jsonArray(z.string()).parse(["a"])).toEqual(["a"]);
  });
});

describe("limitParam", () => {
  it("clamps above the max", () => {
    expect(limitParam(50, 20).parse("999")).toBe(50);
  });
  it("defaults when omitted", () => {
    expect(limitParam(50, 20).parse(undefined)).toBe(20);
  });
  it("defaults on garbage instead of throwing", () => {
    expect(limitParam(50, 20).parse("abc")).toBe(20);
  });
});
