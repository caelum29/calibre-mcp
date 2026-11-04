// #370 §FTS highlight (from #353): NOT's operand includes an FTS5 column filter — `col:`,
// `col :`, `{a b}:` — so the filtered word, phrase or group is negated as a whole and none of
// its words is ever re-highlighted. Covers Cyrillic, loose `<<`/`>>` code, and nested groups.
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — NOT over a column filter negates the whole operand (#370)", () => {
  it("should_unmark_every_word_of_a_col_group", () => {
    expect(repair("docker NOT title:(swarm OR compose)", ">>docker<< >>swarm<< >>compose<<")).toBe(
      ">>docker<< swarm compose",
    );
  });

  it("should_unmark_every_word_of_a_braced_multi_column_group", () => {
    expect(repair("docker NOT {title authors}:(swarm OR compose)", ">>docker<< >>swarm<< >>compose<<")).toBe(
      ">>docker<< swarm compose",
    );
  });

  it("should_unmark_a_braced_multi_column_single_word", () => {
    expect(repair("docker NOT {title authors}:swarm", ">>docker<< and >>swarm<<")).toBe(">>docker<< and swarm");
  });

  it("should_not_turn_the_braced_column_names_into_terms", () => {
    expect(repair("docker NOT {title authors}:swarm", ">>docker<< by >>authors<<")).toBe(">>docker<< by authors");
  });

  it("should_unmark_a_col_phrase", () => {
    expect(repair('docker NOT title:"swarm mode"', ">>docker<< vs >>swarm mode<<")).toBe(">>docker<< vs swarm mode");
  });

  it("should_unmark_a_col_group_written_with_spaces_around_the_colon", () => {
    expect(repair("docker NOT title : (swarm OR compose)", ">>docker<< >>swarm<< >>compose<<")).toBe(
      ">>docker<< swarm compose",
    );
  });

  it("should_unmark_cyrillic_words_of_a_col_group", () => {
    expect(repair("контейнер NOT title:(сеть OR кластер)", ">>контейнеры<< без >>сетями<< и >>кластера<<")).toBe(
      ">>контейнеры<< без сетями и кластера",
    );
  });

  it("should_leave_loose_code_operators_alone_while_unmarking_the_negated_group", () => {
    expect(repair("docker NOT title:(swarm OR x)", "std::cout << >>swarm<< >> y << >>docker<<")).toBe(
      "std::cout << swarm >> y << >>docker<<",
    );
  });

  it("should_unmark_a_nested_group_inside_a_col_filter", () => {
    expect(repair("docker NOT title:((swarm OR compose) AND mode)", ">>docker<< >>swarm<< >>mode<<")).toBe(
      ">>docker<< swarm mode",
    );
  });

  it("should_keep_terms_after_a_negated_col_group_inside_a_positive_group", () => {
    expect(
      repair("(docker NOT title:(swarm OR compose)) OR kubernetes", ">>docker<< >>swarm<< >>kubernetes<< >>compose<<"),
    ).toBe(">>docker<< swarm >>kubernetes<< compose");
  });

  it("should_unmark_col_filters_nested_inside_a_negated_group", () => {
    expect(repair("docker NOT (title:(swarm) OR {title authors}:(compose))", ">>docker<< >>swarm<< >>compose<<")).toBe(
      ">>docker<< swarm compose",
    );
  });

  it("should_still_negate_only_one_token_for_a_colon_inside_a_word", () => {
    // `std::vector` is a term, not a column filter: the word after it stays a query term.
    expect(repair("docker NOT std::vector kubernetes", ">>docker<< >>kubernetes<< >>vector<<")).toBe(
      ">>docker<< >>kubernetes<< vector",
    );
  });
});
