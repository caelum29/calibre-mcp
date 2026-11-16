// Lexical-leak guard for `no-overlap-paraphrase` queries (#359): no content stem of the query
// may occur anywhere in the target book (text, title, authors), so keyword Hit@1 = 0 holds by
// construction in library scope (the keyword half matches any chunk and the title column).

import { describe, expect, it } from "vitest";
import { loadCorpus, loadQueries } from "./harness.js";
import { leakedStems } from "./leak-guard.js";

const { corpus, texts, markers } = loadCorpus();
const queries = loadQueries(texts, markers);
const bookText = (id: number) => {
  const b = corpus.books.find((x) => x.bookId === id)!;
  return [texts.get(id)!, b.title, ...b.authors].join("\n");
};
const targetOf = (relevant: unknown[]) => {
  const r = relevant[0]!;
  return typeof r === "number" ? r : (r as { bookId: number }).bookId;
};

describe("no-overlap-paraphrase lexical-leak guard", () => {
  const nop = queries.filter((q) => q.kind === "no-overlap-paraphrase");

  it("covers all 8 queries, at least 5 on the three new books 122-124", () => {
    expect(nop).toHaveLength(8);
    expect(nop.filter((q) => [122, 123, 124].includes(targetOf(q.relevant))).length).toBeGreaterThanOrEqual(5);
  });

  it.each(nop.map((q) => [q.id, q] as const))("%s shares no content stem with its target book", (_, q) => {
    expect(leakedStems(q.query, bookText(targetOf(q.relevant)))).toEqual([]);
  });

  it("catches a planted counter-example", () => {
    expect(leakedStems("why does memoization speed up a recursive Fibonacci", bookText(122))).toEqual([
      "memoiz",
      "recurs",
      "fibonacci",
    ]);
  });

  it("ignores stop words and stems shorter than 3 characters, in EN and RU", () => {
    expect(leakedStems("what is the cache for", "the cache is for what")).toEqual(["cach"]);
    expect(leakedStems("что такое кэш и где он", "кэш и где он что")).toEqual(["кэш"]);
    expect(leakedStems("an ox at sea", "an ox at sea")).toEqual(["sea"]);
  });
});
