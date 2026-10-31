// #325 (from #315): the highlight checker's rough stem made 2-letter words pass for longer
// query terms (`us`→use, `on`→only/one, `the`→thing), and unmarking a bad span glued it to
// the next word (`>>foo<<>>bogus<<foo` → `>>foo<<bogusfoo`, losing the second match).
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — short-word over-match (#325)", () => {
  const shifted: [query: string, snippet: string, repaired: string][] = [
    ["use", ">>us<< and then use it", "us and then >>use<< it"],
    ["only", ">>on<< the only way", "on the >>only<< way"],
    ["one", ">>on<< one day", "on >>one<< day"],
    ["thing", ">>the<< thing is", "the >>thing<< is"],
    ["things", ">>the<< things are", "the >>things<< are"],
  ];
  for (const [query, snippet, repaired] of shifted) {
    it(`should_treat_a_shifted_${snippet.slice(2, 5).replace("<", "")}_as_invalid_for_query_${query}`, () => {
      expect(repair(query, snippet)).toBe(repaired);
    });
  }

  it("should_not_rehighlight_short_lookalikes_when_repairing", () => {
    expect(repair("use", ">>bogus<< let us use it")).toBe("bogus let us >>use<< it");
    expect(repair("one", ">>bogus<< on one of them")).toBe("bogus on >>one<< of them");
    expect(repair("thing", ">>bogus<< the thing")).toBe("bogus the >>thing<<");
  });

  const stillValid: [term: string, word: string][] = [
    ["use", "using"],
    ["use", "used"],
    ["one", "ones"],
    ["thing", "things"],
    ["us", "us"],
    ["on", "On"],
  ];
  for (const [term, word] of stillValid) {
    it(`should_keep_the_highlight_on_${word}_for_query_${term}`, () => {
      const s = `we see >>${word}<< here`;
      expect(repair(term, s)).toBe(s);
    });
  }
});

describe("FTS highlight repair — no fused words (#325)", () => {
  it("should_keep_the_word_after_an_unmarked_span_separate", () => {
    expect(repair("foo", ">>foo<<>>bogus<<foo")).toBe(">>foo<<bogus>>foo<<");
  });

  it("should_keep_the_word_before_an_unmarked_span_separate", () => {
    expect(repair("foo", "foo>>bogus<< and foo")).toBe(">>foo<<bogus and >>foo<<");
  });

  it("should_still_match_a_phrase_across_an_unmarked_span_with_spaces", () => {
    expect(repair('"event sourcing"', "an event >>sourcing design<< here")).toBe("an >>event sourcing<< design here");
  });
});
