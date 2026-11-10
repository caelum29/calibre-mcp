// `std::vector` is two terms: a colon inside a word is not a column filter (column filters are
// unsupported in mode=fts, #419).
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — colon inside a word", () => {
  it("should_still_treat_a_colon_inside_a_word_as_two_terms", () => {
    // `std::vector` is a term, not a column filter (same rule as after NOT)
    expect(repair("std::vector", ">>bogus<< std vector")).toBe("bogus >>std<< >>vector<<");
  });
});
