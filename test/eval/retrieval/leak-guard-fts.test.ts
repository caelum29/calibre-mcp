// The strict half of the #359 lexical-leak guard. The keyword half ORs EVERY stem of the query
// (store/shared.ts ftsMatch), stop words and short stems included, so the content-stem rule of
// leak-guard.test.ts alone does not make keyword Hit@1 = 0 hold: a query whose only shared
// tokens are "the" or "со" still matches its target book. Measured on the first run
// [27-book fixture]: keyword Hit@1 = 1 for three no-overlap queries that passed the content
// rule. Each no-overlap query must share no FTS token at all with its target book.

import { describe, expect, it } from "vitest";
import { loadCorpus, loadQueries } from "./harness.js";
import { ftsOverlap } from "./leak-guard.js";

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

describe("no-overlap-paraphrase: no FTS token shared with the target book", () => {
  const nop = queries.filter((q) => q.kind === "no-overlap-paraphrase");

  it.each(nop.map((q) => [q.id, q] as const))("%s matches nothing in its target book", (_, q) => {
    expect(ftsOverlap(q.query, bookText(targetOf(q.relevant)))).toEqual([]);
  });

  it("counts stop words and short stems, which the keyword half matches too", () => {
    expect(ftsOverlap("what is the cache for", "the cache is for what")).toEqual(["what", "is", "the", "cach", "for"]);
    expect(ftsOverlap("кэш в сети", "в кэше")).toEqual(["кэш", "в"]);
    expect(ftsOverlap("unrelated words only", "the cache is for what")).toEqual([]);
  });
});
