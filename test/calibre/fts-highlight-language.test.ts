// #325: the short-word and fused-word fixes must not cost a correct highlight on Cyrillic text
// or on natural-language queries, whose short stopwords (to, is, на, не) Calibre highlights too
// (FTS5 has no stopword list).
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — correct highlights survive (#325)", () => {
  const unchanged: [query: string, snippet: string][] = [
    ["how to use event sourcing", ">>How<< >>to<< >>use<< >>event<< >>sourcing<< in practice"],
    ["the thing is", ">>The<< >>thing<< >>is<< simple"],
    ["is it on", "it >>is<< >>on<< the table"],
    ["архітектура", "огляд >>архітектури<< систем"],
    ["не на", "це >>не<< працює >>на<< старих версіях"],
    ["ёлка", "в лесу >>ЁЛКА<< стоит"],
    ['"подієва архітектура"', "про >>подієва архітектура<< тут"],
  ];
  for (const [query, snippet] of unchanged) {
    it(`should_keep_${query}_highlights_unchanged`, () => {
      expect(repair(query, snippet)).toBe(snippet);
    });
  }

  it("should_rehighlight_cyrillic_short_words_only_exactly", () => {
    expect(repair("на", ">>bogus<< на настільки")).toBe("bogus >>на<< настільки");
  });

  it("should_not_fuse_cyrillic_words_around_an_unmarked_span", () => {
    expect(repair("книга", ">>книга<<>>bogus<<книга")).toBe(">>книга<<bogus>>книга<<");
  });
});
