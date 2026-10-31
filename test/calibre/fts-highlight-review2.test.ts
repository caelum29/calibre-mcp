// PR #329 review (#325): the short-word guard looks at the highlighted word only, so a short
// query term keeps its porter inflections (go → going); the suffix rule needs a vowel in the
// stem on its own, not only together with the final-e rule.
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — short query terms keep inflections (PR #329 review)", () => {
  const kept: [term: string, word: string][] = [
    ["go", "going"],
    ["do", "doing"],
    ["be", "being"],
  ];
  for (const [term, word] of kept) {
    it(`should_keep_the_highlight_on_${word}_for_query_${term}`, () => {
      const s = `>>${word}<< home`;
      expect(repair(term, s)).toBe(s);
    });
  }
});

describe("FTS highlight repair — suffix strip needs a vowel (PR #329 review)", () => {
  it("should_not_match_bred_and_bring_through_a_vowelless_stem", () => {
    expect(repair("bring", ">>bred<< to bring")).toBe("bred to >>bring<<");
  });
});
