// Pure merge-semantics tests (spec #50 §3): the clean-room port of Calibre's per-field
// merge rules — fill-if-empty / union / concat / identifiers target-precedence — plus
// format-move planning where the target's copy always wins.

import { describe, it, expect } from "vitest";
import type { Book } from "../../src/domain/book.js";
import type { CustomFieldValue } from "../../src/domain/merge.js";
import {
  mergeBuiltinMetadata,
  mergeCustomMetadata,
  planFormatMoves,
} from "../../src/domain/merge.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 1, uuid: "u", title: "T", authors: ["A"], identifiers: {}, formats: [],
  tags: [], languages: [], ...over,
});

describe("planFormatMoves", () => {
  it("moves formats the target lacks and drops ones it already has", () => {
    const target = book({ id: 10, formats: ["epub"] });
    const src = book({ id: 12, formats: ["pdf", "epub"] });
    expect(planFormatMoves(target, [src])).toEqual([
      { format: "pdf", sourceId: 12, action: "moves" },
      { format: "epub", sourceId: 12, action: "dropped" },
    ]);
  });

  it("first source wins among sources offering the same format", () => {
    const target = book({ id: 10, formats: [] });
    const s1 = book({ id: 11, formats: ["pdf"] });
    const s2 = book({ id: 12, formats: ["pdf"] });
    expect(planFormatMoves(target, [s1, s2])).toEqual([
      { format: "pdf", sourceId: 11, action: "moves" },
      { format: "pdf", sourceId: 12, action: "dropped" },
    ]);
  });
});

describe("mergeBuiltinMetadata", () => {
  it("fills empty fields from the first source that has them", () => {
    const target = book({ authors: ["Unknown"], publisher: undefined, rating: undefined });
    const s1 = book({ id: 2, authors: ["Unknown"], publisher: "PubA" });
    const s2 = book({ id: 3, authors: ["Real Author"], rating: 4 });
    const changes = mergeBuiltinMetadata(target, [s1, s2]);
    expect(changes.publisher).toBe("PubA");
    expect(changes.authors).toEqual(["Real Author"]);
    expect(changes.rating).toBe(4);
  });

  it("does not overwrite fields the target already has", () => {
    const target = book({ publisher: "Mine", rating: 5, series: "S", comments: "c" });
    const src = book({ id: 2, publisher: "Other", rating: 1, series: "X", comments: "c" });
    const changes = mergeBuiltinMetadata(target, [src]);
    expect(changes.publisher).toBeUndefined();
    expect(changes.rating).toBeUndefined();
    expect(changes.series).toBeUndefined();
    expect(changes.comments).toBeUndefined();
  });

  it("treats Calibre's 0101-01-01 sentinel as an empty pubdate", () => {
    const target = book({ pubdate: "0101-01-01T00:00:00+00:00" });
    const src = book({ id: 2, pubdate: "2020-05-01T00:00:00+00:00" });
    expect(mergeBuiltinMetadata(target, [src]).pubdate).toBe("2020-05-01T00:00:00+00:00");
  });

  it("fills series together with its index", () => {
    const target = book({ series: undefined });
    const src = book({ id: 2, series: "Saga", seriesIndex: 3 });
    const changes = mergeBuiltinMetadata(target, [src]);
    expect(changes.series).toBe("Saga");
    expect(changes.series_index).toBe(3);
  });

  it("unions tags preserving target order first", () => {
    const target = book({ tags: ["b", "a"] });
    const src = book({ id: 2, tags: ["A", "c"] });
    expect(mergeBuiltinMetadata(target, [src]).tags).toEqual(["b", "a", "c"]);
  });

  it("concatenates distinct comments with a blank line, skipping ones identical to the target's", () => {
    const target = book({ comments: "dest" });
    const s1 = book({ id: 2, comments: "dest" });
    const s2 = book({ id: 3, comments: "src" });
    expect(mergeBuiltinMetadata(target, [s1, s2]).comments).toBe("dest\n\nsrc");
  });

  it("unions identifiers with target precedence on conflicting schemes", () => {
    const target = book({ identifiers: { isbn: "111" } });
    const src = book({ id: 2, identifiers: { isbn: "222", doi: "d1" } });
    expect(mergeBuiltinMetadata(target, [src]).identifiers).toEqual({ isbn: "111", doi: "d1" });
  });

  it("returns no change when nothing differs", () => {
    const target = book({ tags: ["a"], identifiers: { isbn: "1" }, comments: "c" });
    const src = book({ id: 2, tags: ["a"], identifiers: { isbn: "1" }, comments: "c" });
    expect(mergeBuiltinMetadata(target, [src])).toEqual({});
  });
});

const field = (over: Partial<CustomFieldValue>): CustomFieldValue => ({
  label: "#x", datatype: "text", isMultiple: false, value: null, ...over,
});

describe("mergeCustomMetadata", () => {
  it("unions multi-value columns (replace-wholesale means the union is computed here)", () => {
    const target = [field({ label: "#m", isMultiple: true, value: ["a"] })];
    const src = [[field({ label: "#m", isMultiple: true, value: ["a", "b"] })]];
    expect(mergeCustomMetadata(target, src)).toEqual({ "#m": ["a", "b"] });
  });

  it("fills empty scalar columns and encodes per datatype", () => {
    const target = [
      field({ label: "#b", datatype: "bool", value: null }),
      field({ label: "#s", datatype: "series", value: null }),
      field({ label: "#i", datatype: "int", value: null }),
    ];
    const src = [[
      field({ label: "#b", datatype: "bool", value: true }),
      field({ label: "#s", datatype: "series", value: "Saga", extra: 2 }),
      field({ label: "#i", datatype: "int", value: 42 }),
    ]];
    expect(mergeCustomMetadata(target, src)).toEqual({ "#b": "true", "#s": "Saga [2]", "#i": 42 });
  });

  it("keeps a false bool on the target (false is a value, not empty)", () => {
    const target = [field({ label: "#b", datatype: "bool", value: false })];
    const src = [[field({ label: "#b", datatype: "bool", value: true })]];
    expect(mergeCustomMetadata(target, src)).toEqual({});
  });

  it("concatenates comments-type columns", () => {
    const target = [field({ label: "#c", datatype: "comments", value: "one" })];
    const src = [[field({ label: "#c", datatype: "comments", value: "two" })]];
    expect(mergeCustomMetadata(target, src)).toEqual({ "#c": "one\n\ntwo" });
  });

  it("skips composite (computed) columns", () => {
    const target = [field({ label: "#comp", datatype: "composite", value: null })];
    const src = [[field({ label: "#comp", datatype: "composite", value: "computed" })]];
    expect(mergeCustomMetadata(target, src)).toEqual({});
  });
});
