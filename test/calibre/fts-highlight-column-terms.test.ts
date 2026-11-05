// #389 §FTS highlight: an FTS5 column filter outside NOT (`title:x`, `{title authors}:x`) names a
// column, not a search term — the column name must never be re-highlighted, only its operand.
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — column names are not terms (#389)", () => {
  it("should_not_highlight_the_column_name_of_a_title_filter", () => {
    expect(repair("title:docker", ">>bogus<< title docker")).toBe("bogus title >>docker<<");
  });

  it("should_not_highlight_the_column_names_of_a_brace_filter", () => {
    expect(repair("{title authors}:docker", ">>bogus<< title authors docker")).toBe("bogus title authors >>docker<<");
  });

  it("should_not_highlight_the_column_name_of_a_filtered_group", () => {
    expect(repair("title:(docker OR swarm)", ">>bogus<< title docker swarm")).toBe("bogus title >>docker<< >>swarm<<");
  });

  it("should_not_highlight_the_column_name_of_a_filtered_phrase", () => {
    expect(repair('title:"docker swarm"', ">>bogus<< title docker swarm")).toBe("bogus title >>docker swarm<<");
  });

  it("should_not_highlight_the_column_name_of_a_spaced_filter", () => {
    expect(repair("title : docker", ">>bogus<< title docker")).toBe("bogus title >>docker<<");
  });

  it("should_keep_a_prefix_operand_behind_a_column_filter", () => {
    expect(repair("title:dock*", ">>bogus<< title docker")).toBe("bogus title >>docker<<");
  });

  it("should_not_treat_a_column_filtered_NEAR_as_the_word_NEAR", () => {
    expect(repair("title:NEAR(docker swarm, 5)", ">>bogus<< near title docker swarm")).toBe(
      "bogus near title >>docker<< >>swarm<<",
    );
  });

  it("should_keep_the_column_name_when_it_is_also_a_quoted_term", () => {
    expect(repair('title:docker OR "title"', ">>bogus<< title docker")).toBe("bogus >>title<< >>docker<<");
  });

  it("should_still_treat_a_colon_inside_a_word_as_two_terms", () => {
    // `std::vector` is a term, not a column filter (same rule as after NOT)
    expect(repair("std::vector", ">>bogus<< std vector")).toBe("bogus >>std<< >>vector<<");
  });

  it("should_leave_a_good_snippet_untouched", () => {
    expect(repair("title:docker", ">>docker<< title")).toBe(">>docker<< title");
  });
});
