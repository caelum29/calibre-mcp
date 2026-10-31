// PR #332 review (#325): Calibre 9.17 run via calibre-debug shows a case-only tag/author set
// RENAMES the shared item on every book (it is not reused silently), so the preview needs its
// own rename note; identifier values compare as strings; a case-duplicate list counts once.
import { describe, expect, it } from "vitest";
import { caseRenameNotes, listReplacementNote, type ChangeValue } from "../../src/domain/book-fields.js";

const diff = (field: string, before: unknown, after: unknown) => ({
  field,
  before,
  after: after as ChangeValue,
  changed: true,
});

describe("caseRenameNotes — library-wide renames (PR #332 review)", () => {
  it("should_note_a_case_only_tag_rename", () => {
    expect(caseRenameNotes(diff("tags", ["Python", "Rust"], ["python", "Rust"]))).toEqual([
      "tags: Python → python renames it on every book in the library (Calibre keeps one case-insensitive item)",
    ]);
  });

  it("should_note_author_renames_and_the_string_form", () => {
    expect(caseRenameNotes(diff("authors", ["Martin Fowler"], "martin fowler & Kent Beck"))).toEqual([
      "authors: Martin Fowler → martin fowler renames it on every book in the library (Calibre keeps one case-insensitive item)",
    ]);
  });

  it("should_note_a_cyrillic_rename", () => {
    expect(caseRenameNotes(diff("tags", ["Пайтон"], ["ПАЙТОН"]))).toEqual([
      "tags: Пайтон → ПАЙТОН renames it on every book in the library (Calibre keeps one case-insensitive item)",
    ]);
  });

  it("should_say_nothing_for_unchanged_case_new_items_or_other_fields", () => {
    expect(caseRenameNotes(diff("tags", ["Python"], ["Python", "go"]))).toEqual([]);
    expect(caseRenameNotes(diff("tags", ["İstanbul"], ["istanbul"]))).toEqual([]);
    expect(caseRenameNotes(diff("title", "Python", "python"))).toEqual([]);
    expect(caseRenameNotes(diff("identifiers", { isbn: "1" }, { ISBN: "1" }))).toEqual([]);
  });
});

describe("listReplacementNote — review fixes (PR #332 review)", () => {
  it("should_compare_identifier_values_as_strings", () => {
    expect(listReplacementNote(diff("identifiers", { isbn: "1" }, { isbn: 1 }))).toBeUndefined();
  });

  it("should_count_case_duplicates_once", () => {
    expect(listReplacementNote(diff("tags", ["A", "B"], ["Python", "python"]))).toBe(
      "tags: 2 → 1 (replaces all existing tags)",
    );
  });

  it("should_keep_dotted_capital_I_distinct_from_i", () => {
    expect(listReplacementNote(diff("tags", ["İstanbul"], ["istanbul"]))).toBe(
      "tags: 1 → 1 (replaces all existing tags)",
    );
  });
});
