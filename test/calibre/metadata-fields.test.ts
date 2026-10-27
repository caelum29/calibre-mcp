import { describe, it, expect } from "vitest";
import {
  buildSetMetadataArgs,
  changesSatisfied,
  formatFieldValue,
  isAllowedField,
  previewBookChanges,
  sameFieldValue,
} from "../../src/calibre/metadata-fields.js";
import type { Book } from "../../src/domain/book.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 1,
  uuid: "u",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: ["en"],
  ...over,
});

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

describe("previewBookChanges", () => {
  it("flags a real change and a no-op against the current value", () => {
    const diff = previewBookChanges(book({ tags: ["old"], publisher: "P" }), {
      tags: ["new"],
      publisher: "P",
    });
    expect(diff).toEqual([
      { field: "tags", before: ["old"], after: ["new"], changed: true },
      { field: "publisher", before: "P", after: "P", changed: false },
    ]);
  });

  it("treats a custom #column (absent on Book) as a change", () => {
    const diff = previewBookChanges(book(), { "#shelf": "to-read" });
    expect(diff[0]).toMatchObject({ field: "#shelf", before: undefined, changed: true });
  });
});

describe("changesSatisfied", () => {
  it("is satisfied when the re-read equals the intended values", () => {
    const before = book({ publisher: "Old" });
    const after = book({ publisher: "New" });
    expect(changesSatisfied(before, after, { publisher: "New" })).toBe(true);
  });

  it("is satisfied when a normalized-on-write field moved away from the before value", () => {
    // Calibre normalizes pubdate on write, so re-read ≠ intended but ≠ before → applied.
    const before = book({ pubdate: "2001-01-01T00:00:00+00:00" });
    const after = book({ pubdate: "2002-01-15T00:00:00+00:00" });
    expect(changesSatisfied(before, after, { pubdate: "2002-01-15" })).toBe(true);
  });

  it("is satisfied when the intended value was already current (no-op write)", () => {
    const same = book({ publisher: "P" });
    expect(changesSatisfied(same, same, { publisher: "P" })).toBe(true);
  });

  it("is not satisfied when the re-read still shows the old value", () => {
    const same = book({ publisher: "Old" });
    expect(changesSatisfied(same, same, { publisher: "New" })).toBe(false);
  });

  it("is not satisfied for unverifiable custom #columns", () => {
    expect(changesSatisfied(book(), book(), { "#shelf": "to-read" })).toBe(false);
  });

  it("requires EVERY requested field to have landed", () => {
    const before = book({ publisher: "Old", tags: ["old"] });
    const after = book({ publisher: "New", tags: ["old"] });
    expect(changesSatisfied(before, after, { publisher: "New", tags: ["new"] })).toBe(false);
  });
});

describe("sameFieldValue", () => {
  it.each([
    ["equal strings", "a", "a"],
    ["equal numbers", 4, 4],
    ["null and undefined (both empty)", null, undefined],
    ["equal lists", ["A", "B"], ["A", "B"]],
    ["empty lists", [], []],
    ["maps with keys in a different order", { isbn: "1", doi: "d" }, { doi: "d", isbn: "1" }],
    ["empty maps", {}, {}],
  ])("treats %s as the same value", (_label, a, b) => {
    expect(sameFieldValue(a, b)).toBe(true);
  });

  it.each([
    ["different strings", "a", "b"],
    ["a value and empty", "a", null],
    ["empty and a value", undefined, "a"],
    ["the same names in a different order", ["A", "B"], ["B", "A"]],
    ["lists of different length", ["A"], ["A", "B"]],
    ["a longer list against a prefix", ["A", "B"], ["A"]],
    ["lists differing in one element", ["A", "B"], ["A", "C"]],
    ["a list and a scalar", ["A"], "A"],
    ["a scalar and a list", "A", ["A"]],
    ["a list and a map", ["1"], { 0: "1" }],
    ["maps with a different value", { isbn: "1" }, { isbn: "2" }],
    ["maps where only one key differs", { isbn: "1", doi: "d" }, { isbn: "1", doi: "x" }],
    ["a map with an extra key", { isbn: "1" }, { isbn: "1", doi: "d" }],
    ["maps with different keys of the same count", { isbn: undefined }, { doi: undefined }],
    ["a map and empty", { isbn: "1" }, null],
    ["a map and a string with the same indexed content", { 0: "x" }, "x"],
    ["a string and a map with the same indexed content", "x", { 0: "x" }],
    ["a number and its string form", 4, "4"],
  ])("treats %s as different", (_label, a, b) => {
    expect(sameFieldValue(a, b)).toBe(false);
  });
});
