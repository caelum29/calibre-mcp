// #340: highlight repair matches inflections through the shared EN+RU Snowball stemmer (not an
// English-only twin), and never marks a word the query negates with NOT — bare, phrase, prefix
// or group operand. Cyrillic, mixed EN/RU and code with loose >>/<< operators are covered.
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — Snowball stems (#340)", () => {
  it("should_rehighlight_russian_case_forms_of_kontejner", () => {
    expect(repair("контейнер", ">>bogus<< список контейнеров и контейнерами")).toBe(
      "bogus список >>контейнеров<< и >>контейнерами<<",
    );
  });

  // кодами / сетями share the query's Snowball stem but fail the common-prefix fallback
  // (short term, 3+ extra letters), so only the stemmer can match them.
  it("should_rehighlight_stem_only_russian_inflections", () => {
    expect(repair("код сеть", ">>bogus<< между кодами и сетями")).toBe("bogus между >>кодами<< и >>сетями<<");
  });

  it("should_keep_a_valid_highlight_on_a_stem_only_russian_inflection", () => {
    const s = "работа с >>кодами<< и >>сетями<<";
    expect(repair("код сеть", s)).toBe(s);
  });

  it("should_rehighlight_mixed_english_and_russian_terms", () => {
    expect(repair("docker контейнер", ">>Запуск<< docker-контейнеров на сервере")).toBe(
      "Запуск >>docker<<->>контейнеров<< на сервере",
    );
  });

  it("should_leave_loose_shift_operators_in_code_alone_with_a_cyrillic_term", () => {
    expect(repair("код", "cin >> x; >>bogus<< кодами << y")).toBe("cin >> x; bogus >>кодами<< << y");
  });
});

describe("FTS highlight repair — NOT operands are never terms (#340)", () => {
  it("should_never_mark_the_negated_word", () => {
    expect(repair("docker NOT swarm", ">>docker<< and >>swarm<< mode")).toBe(">>docker<< and swarm mode");
  });

  it("should_not_rehighlight_the_negated_word_when_repairing", () => {
    expect(repair("docker NOT swarm", ">>bogus<< docker swarm")).toBe("bogus >>docker<< swarm");
  });

  it("should_never_mark_a_negated_phrase", () => {
    expect(repair('kubernetes NOT "docker swarm"', ">>kubernetes<< vs >>docker swarm<<")).toBe(
      ">>kubernetes<< vs docker swarm",
    );
  });

  it("should_never_mark_a_negated_prefix", () => {
    expect(repair("kubernetes NOT swarm*", ">>kubernetes<< beats >>swarming<<")).toBe(">>kubernetes<< beats swarming");
  });

  it("should_never_mark_a_negated_group", () => {
    expect(repair("docker NOT (swarm OR compose)", ">>docker<< >>swarm<< >>compose<<")).toBe(
      ">>docker<< swarm compose",
    );
  });

  it("should_still_mark_a_term_that_is_also_positive", () => {
    expect(repair('swarm NOT "swarm mode"', ">>bogus<< swarm mode")).toBe("bogus >>swarm<< mode");
  });

  it("should_never_mark_a_negated_cyrillic_word", () => {
    expect(repair("контейнер NOT сеть", ">>контейнеры<< без >>сетями<<")).toBe(">>контейнеры<< без сетями");
  });
});
