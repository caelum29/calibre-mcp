// #342: previews and merge compare field values with the one equality (sameFieldValue), so an
// unchanged empty field or a key-reordered identifiers map is no change; the list-replacement
// note says what a partial replacement drops instead of claiming everything is wiped.
import { describe, expect, it } from "vitest";
import type { Book } from "../../src/domain/book.js";
import { listReplacementNote, previewBookChanges, type ChangeValue } from "../../src/domain/book-fields.js";
import { mergeBuiltinMetadata } from "../../src/domain/merge.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 1,
  uuid: "u",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: [],
  tags: [],
  languages: [],
  ...over,
});

const changedOf = (b: Book, changes: Record<string, ChangeValue>): boolean[] =>
  previewBookChanges(b, changes).map((d) => d.changed);

describe("previewBookChanges — one equality (#342)", () => {
  it("should_show_no_change_when_clearing_an_absent_field", () => {
    expect(changedOf(book(), { comments: "", publisher: "" })).toEqual([false, false]);
  });

  it("should_show_no_change_for_key_reordered_identifiers", () => {
    expect(changedOf(book({ identifiers: { isbn: "1", doi: "x" } }), { identifiers: { doi: "x", isbn: "1" } })).toEqual(
      [false],
    );
  });

  it("should_show_no_change_when_emptying_an_empty_list", () => {
    expect(changedOf(book({ tags: [] }), { tags: [] })).toEqual([false]);
  });

  it("should_still_show_a_real_change", () => {
    expect(changedOf(book({ identifiers: { isbn: "1" } }), { identifiers: { isbn: "2" }, comments: "new" })).toEqual([
      true,
      true,
    ]);
  });
});

describe("mergeBuiltinMetadata — identifiers via the one equality (#342)", () => {
  it("should_not_propose_identifiers_that_only_differ_in_key_order", () => {
    const target = book({ identifiers: { isbn: "1", doi: "d" } });
    const src = book({ id: 2, identifiers: { doi: "d", isbn: "1" } });
    expect(mergeBuiltinMetadata(target, [src]).identifiers).toBeUndefined();
  });

  it("should_still_propose_a_new_identifier_from_a_source", () => {
    const target = book({ identifiers: { isbn: "1" } });
    const src = book({ id: 2, identifiers: { doi: "d" } });
    expect(mergeBuiltinMetadata(target, [src]).identifiers).toEqual({ doi: "d", isbn: "1" });
  });
});

const note = (field: string, before: unknown, after: ChangeValue): string | undefined =>
  listReplacementNote({ field, before, after, changed: true });

describe("listReplacementNote — says what a partial replacement drops (#342)", () => {
  it("should_name_the_dropped_tags_when_some_are_kept", () => {
    expect(note("tags", ["x", "y", "z"], ["x", "w"])).toBe("tags: 3 → 2 (replaces the list: drops y, z)");
  });

  it("should_name_the_dropped_tags_in_the_string_form", () => {
    expect(note("tags", ["x", "y", "z"], "x, z")).toBe("tags: 3 → 2 (replaces the list: drops y)");
  });

  it("should_not_list_a_case_renamed_tag_as_dropped", () => {
    expect(note("tags", ["Python", "Rust"], ["python"])).toBe("tags: 2 → 1 (replaces the list: drops Rust)");
  });

  it("should_name_a_dropped_identifier_with_its_value", () => {
    expect(note("identifiers", { isbn: "1", doi: "x" }, { isbn: "2", doi: "x" })).toBe(
      "identifiers: 2 → 2 (replaces the list: drops isbn:1)",
    );
  });

  it("should_cap_a_long_drop_list", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(note("tags", fifteen, ["t0"])).toBe("tags: 15 → 1 (replaces the list: drops t1, t2, t3, t4, t5 and 9 more)");
  });

  it("should_keep_replaces_all_when_nothing_is_kept", () => {
    expect(note("tags", ["x", "y", "z"], ["a", "b"])).toBe("tags: 3 → 2 (replaces all existing tags)");
  });

  it("should_keep_replaces_all_for_a_value_only_identifier_change", () => {
    expect(note("identifiers", { isbn: "1" }, { isbn: "2" })).toBe(
      "identifiers: 1 → 1 (replaces all existing identifiers)",
    );
  });

  it("should_stay_silent_when_nothing_is_dropped", () => {
    expect(note("tags", ["x"], ["X", "y"])).toBeUndefined();
  });
});
