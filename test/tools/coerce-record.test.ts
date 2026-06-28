import { describe, it, expect } from "vitest";
import { z } from "zod";
import { jsonRecord } from "../../src/tools/coerce.js";

describe("jsonRecord", () => {
  it("accepts a real object unchanged", () => {
    expect(jsonRecord(z.string()).parse({ a: "b" })).toEqual({ a: "b" });
  });
  it("parses a JSON-string object (the -32602 case)", () => {
    expect(jsonRecord(z.string()).parse('{"tags":"rust"}')).toEqual({ tags: "rust" });
  });
  it("validates values against the inner schema", () => {
    const union = z.union([z.string(), z.array(z.string())]);
    expect(jsonRecord(union).parse('{"tags":["a","b"]}')).toEqual({ tags: ["a", "b"] });
  });
});
