// PR #315 review (#308): only tight `>>word<<` spans are Calibre highlights — code `>>`/`<<`
// stays byte-identical; validity is lenient on English inflections; repair is per span, so a
// valid highlight survives next to a bad one; ё/Ё fold the same way.
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — code operators (PR #315 review)", () => {
  it("should_leave_an_unmarked_code_snippet_byte_identical", () => {
    const code = "std::cin >> x; std::cout << y;";
    expect(repair("cout", code)).toBe(code);
  });

  it("should_leave_loose_shift_operators_alone_next_to_a_valid_highlight", () => {
    const s = "cmd >> out.txt && echo >>event<< << foo";
    expect(repair("event", s)).toBe(s);
  });

  it("should_keep_loose_operators_when_repairing_a_bad_tight_span", () => {
    expect(repair("cout", "cin >> x; >>bogus<< cout << y")).toBe("cin >> x; bogus >>cout<< << y");
  });
});

describe("FTS highlight repair — lenient inflections (PR #315 review)", () => {
  const pairs: [string, string][] = [
    ["run", "running"],
    ["map", "mapping"],
    ["set", "setting"],
    ["log", "logging"],
    ["make", "making"],
    ["use", "using"],
    ["type", "typing"],
    ["store", "stored"],
    ["quick", "quickly"],
    ["configure", "configuration"],
  ];
  for (const [term, word] of pairs) {
    it(`should_keep_the_highlight_on_${word}_for_query_${term}`, () => {
      const s = `we are >>${word}<< it`;
      expect(repair(term, s)).toBe(s);
    });
  }
});

describe("FTS highlight repair — per span (PR #315 review)", () => {
  it("should_keep_a_valid_span_and_rehighlight_around_a_bad_one", () => {
    expect(repair("run", ">>running<< fast and >>bogus<< again, run")).toBe(
      ">>running<< fast and bogus again, >>run<<",
    );
  });
});

describe("FTS highlight repair — folding (PR #315 review)", () => {
  it("should_fold_capital_Yo_like_lowercase_yo", () => {
    expect(repair("Ёлка", ">>the<< ёлка")).toBe("the >>ёлка<<");
  });
});
