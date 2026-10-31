// #325 (from #313): the bulk_update preview's "replaces all existing" flag must follow
// Calibre's semantics. Tags/authors/languages are case-insensitive unique items (a set of
// `python` reuses the existing `Python` item, nothing is dropped); identifier types are
// lowercased; a value-only identifier change still replaces the existing value.
import { describe, expect, it } from "vitest";
import { listReplacementNote, type ChangeValue } from "../../src/domain/book-fields.js";

const note = (field: string, before: unknown, after: ChangeValue): string | undefined =>
  listReplacementNote({ field, before, after, changed: true });

describe("listReplacementNote — case-insensitive list items (#325)", () => {
  it("should_not_flag_a_case_only_tag_change", () => {
    expect(note("tags", ["Python", "Rust"], ["python", "rust"])).toBeUndefined();
  });

  it("should_not_flag_a_case_only_change_in_the_string_form", () => {
    expect(note("tags", ["Python", "Rust"], "python, RUST")).toBeUndefined();
  });

  it("should_not_flag_case_only_author_or_language_changes", () => {
    expect(note("authors", ["Martin Fowler"], ["martin fowler"])).toBeUndefined();
    expect(note("languages", ["eng"], ["ENG"])).toBeUndefined();
  });

  it("should_not_flag_a_case_only_cyrillic_tag_change", () => {
    expect(note("tags", ["Архітектура", "Ёлка"], ["архітектура", "ёлка"])).toBeUndefined();
  });

  it("should_still_flag_a_dropped_tag_next_to_a_case_change", () => {
    expect(note("tags", ["Python", "Rust"], ["python"])).toBe("tags: 2 → 1 (replaces all existing tags)");
  });
});

describe("listReplacementNote — identifier values (#325)", () => {
  it("should_flag_a_value_only_identifier_change", () => {
    expect(note("identifiers", { isbn: "1" }, { isbn: "2" })).toBe(
      "identifiers: 1 → 1 (replaces all existing identifiers)",
    );
  });

  it("should_flag_a_changed_value_next_to_kept_identifiers", () => {
    expect(note("identifiers", { isbn: "1", doi: "x" }, { isbn: "2", doi: "x" })).toBe(
      "identifiers: 2 → 2 (replaces all existing identifiers)",
    );
  });

  it("should_not_flag_unchanged_or_growing_identifiers", () => {
    expect(note("identifiers", { isbn: "1" }, { isbn: "1" })).toBeUndefined();
    expect(note("identifiers", { isbn: "1" }, { isbn: "1", asin: "B0" })).toBeUndefined();
  });

  it("should_treat_identifier_types_case_insensitively", () => {
    expect(note("identifiers", { isbn: "1" }, { ISBN: "1" })).toBeUndefined();
  });
});
