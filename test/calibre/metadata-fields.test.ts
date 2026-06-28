import { describe, it, expect } from "vitest";
import {
  buildSetMetadataArgs,
  formatFieldValue,
  isAllowedField,
} from "../../src/calibre/metadata-fields.js";

describe("formatFieldValue", () => {
  it("joins authors with ' & '", () => {
    expect(formatFieldValue("authors", ["Ann", "Bob"])).toBe("Ann & Bob");
  });
  it("joins tags with commas", () => {
    expect(formatFieldValue("tags", ["rust", "systems"])).toBe("rust,systems");
  });
  it("joins languages with commas", () => {
    expect(formatFieldValue("languages", ["en", "ru"])).toBe("en,ru");
  });
  it("renders identifiers as scheme:value pairs", () => {
    expect(formatFieldValue("identifiers", { isbn: "123", doi: "10.x" })).toBe("isbn:123,doi:10.x");
  });
  it("stringifies a numeric rating", () => {
    expect(formatFieldValue("rating", 4)).toBe("4");
  });
  it("keeps a scalar title verbatim (colons survive)", () => {
    expect(formatFieldValue("title", "Rust: The Book")).toBe("Rust: The Book");
  });
  it("throws when identifiers is not an object", () => {
    expect(() => formatFieldValue("identifiers", "isbn:123")).toThrow();
  });
});

describe("isAllowedField", () => {
  it("accepts known built-in fields", () => {
    expect(isAllowedField("title")).toBe(true);
    expect(isAllowedField("tags")).toBe(true);
  });
  it("accepts custom #columns", () => {
    expect(isAllowedField("#myrating")).toBe(true);
  });
  it("rejects unknown fields", () => {
    expect(isAllowedField("evil")).toBe(false);
  });
});

describe("buildSetMetadataArgs", () => {
  it("builds repeated --field argv tokens", () => {
    const args = buildSetMetadataArgs(658, { tags: ["rust"], rating: 5 });
    expect(args).toEqual(["set_metadata", "658", "--field", "tags:rust", "--field", "rating:5"]);
  });
});
