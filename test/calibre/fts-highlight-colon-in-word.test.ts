// #370: a colon inside a word (`std::vector`) is a term, not a column filter. Column filters
// themselves are unsupported in mode=fts (Calibre rejects them, #419), so no highlight code exists for them.
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — colon inside a word is a term (#370)", () => {
  it("should_still_negate_only_one_token_for_a_colon_inside_a_word", () => {
    // `std::vector` is a term, not a column filter: the word after it stays a query term.
    expect(repair("docker NOT std::vector kubernetes", ">>docker<< >>kubernetes<< >>vector<<")).toBe(
      ">>docker<< >>kubernetes<< vector",
    );
  });
});
