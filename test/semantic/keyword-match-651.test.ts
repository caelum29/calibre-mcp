// The keyword half's MATCH rendered from the #651 plan: stems deduped, a stem in more than half of
// the library's chunks (body_stem) pruned, a pruned stem's identifier forms gone with it, and
// today's MATCH whenever term statistics are missing or fail. Fake TermStats, no index.

import { describe, expect, it } from "vitest";
import type { KeywordColumn, TermStats } from "../../src/domain/search/keyword-plan.js";
import { ftsMatch, keywordMatch } from "../../src/semantic/store/shared.js";

/** body_stem document frequencies over 1000 chunks; unlisted stems are rare (1 chunk). */
function stats(df: Record<string, number>): TermStats {
  return {
    totalDocs: 1000,
    docFreq: (term: string, column: KeywordColumn) => (column === "body_stem" ? (df[term] ?? 1) : 0),
  };
}

const failing: TermStats = {
  totalDocs: 1000,
  docFreq: () => {
    throw new Error("no such module: fts5vocab");
  },
};

describe("keywordMatch (#651)", () => {
  it("should_prune_a_stem_in_more_than_half_of_the_chunks", () => {
    expect(keywordMatch("how does the raft consensus work", stats({ the: 780 }))).toEqual({
      match: '"how" OR "doe" OR "raft" OR "consensus" OR "work"',
      dropped: [{ term: "the", reason: "too-common" }],
    });
  });

  it("should_keep_a_stem_at_exactly_half_of_the_chunks", () => {
    expect(keywordMatch("the raft", stats({ the: 500 })).match).toBe('"the" OR "raft"');
  });

  it("should_send_a_repeated_stem_once", () => {
    expect(keywordMatch("C# and c# again", stats({}))).toEqual({
      match: '"c" OR "and" OR "again" OR "c#" OR "c#."',
      dropped: [{ term: "c", reason: "duplicate" }],
    });
  });

  it("should_drop_an_identifier_whose_stems_are_all_pruned", () => {
    expect(keywordMatch("is-a relation", stats({ is: 900, a: 950 }))).toEqual({
      match: '"relat"',
      dropped: [
        { term: "is", reason: "too-common" },
        { term: "a", reason: "too-common" },
        { term: "is-a", reason: "too-common" },
      ],
    });
  });

  it("should_keep_an_identifier_when_only_some_of_its_stems_are_pruned", () => {
    expect(keywordMatch("the node.js runtime", stats({ the: 900 })).match).toBe(
      '"node" OR "js" OR "runtim" OR "node.js" OR "node.js."',
    );
  });

  it("should_keep_the_rarest_stem_when_every_stem_is_too_common", () => {
    expect(keywordMatch("the and", stats({ the: 900, and: 800 }))).toEqual({
      match: '"and"',
      dropped: [{ term: "the", reason: "too-common" }],
    });
  });

  it("should_never_prune_a_one_word_query", () => {
    expect(keywordMatch("the", stats({ the: 900 }))).toEqual({ match: '"the"', dropped: [] });
  });

  it("should_never_prune_a_word_inside_a_quoted_span", () => {
    expect(keywordMatch('"the" matrix', stats({ the: 900 }))).toEqual({ match: '"the" OR "matrix"', dropped: [] });
  });

  // std::move: the index keeps no `:`, so the words are two terms; the `std move` phrase clause
  // waits for the phrase step (bigrams off). Inside Russian prose nothing is pruned at these shares.
  it("should_keep_std_and_move_as_terms_inside_cyrillic_prose", () => {
    expect(keywordMatch("как работает std::move в C++", stats({ в: 120, как: 110 }))).toEqual({
      match: '"как" OR "работа" OR "std" OR "move" OR "в" OR "c" OR "c++" OR "c++."',
      dropped: [],
    });
  });

  it("should_keep_std_and_move_when_a_stop_word_beside_them_is_pruned", () => {
    expect(keywordMatch("use std::move for the buffer", stats({ use: 576, the: 780, for: 700 }))).toEqual({
      match: '"std" OR "move" OR "buffer"',
      dropped: [
        { term: "use", reason: "too-common" },
        { term: "for", reason: "too-common" },
        { term: "the", reason: "too-common" },
      ],
    });
  });

  it("should_return_null_for_a_query_without_searchable_tokens", () => {
    expect(keywordMatch("+++ ... -- #", stats({}))).toEqual({ match: null, dropped: [] });
  });

  it("should_fall_back_to_todays_match_when_term_statistics_fail", () => {
    const q = "how does the raft consensus work in c++";
    expect(keywordMatch(q, failing)).toEqual({ match: ftsMatch(q) });
  });

  it("should_render_todays_match_without_term_statistics", () => {
    expect(keywordMatch("C# and c# again")).toEqual({ match: '"c" OR "and" OR "c" OR "again" OR "c#" OR "c#."' });
  });
});
