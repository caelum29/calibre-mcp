// Keyword-query planner (#651): table-driven cases per rule — stem dedupe, pruning by
// document-frequency share, bigram and quoted-span phrase clauses, and the guards that keep a
// query from losing all its terms — over a fake TermStats.

import { describe, expect, it } from "vitest";
import {
  type KeywordColumn,
  type KeywordPlan,
  type KeywordToken,
  type TermStats,
  planKeywordQuery,
} from "../../../src/domain/search/keyword-plan.js";

// 1000 chunks; df per stem in body_stem. "the"/"of" 90%, "how" 40%, content words rare.
function fakeStats(df: Record<string, number>, totalDocs = 1000): TermStats & { calls: string[] } {
  const calls: string[] = [];
  return {
    totalDocs,
    calls,
    docFreq(term: string, column: KeywordColumn): number {
      calls.push(`${column}:${term}`);
      return column === "body_stem" ? (df[term] ?? 0) : 0;
    },
  };
}
const DF = { the: 900, of: 900, how: 400, split: 30, brain: 12, token: 50, bucket: 8, memori: 200 };

// tokens from "stem/raw" words; a word wrapped in [n] belongs to quoted span n
const toks = (...words: string[]): KeywordToken[] =>
  words.map((w) => {
    const m = /^\[(\d+)\](.*)$/.exec(w);
    const [stem = "", raw] = (m ? (m[2] ?? "") : w).split("/");
    return m ? { stem, raw: raw ?? stem, span: Number(m[1]) } : { stem, raw: raw ?? stem };
  });

const plan = (tokens: KeywordToken[], maxDocShare = 0.5, extra: { bigrams?: boolean } = {}): KeywordPlan =>
  planKeywordQuery(tokens, fakeStats(DF), { maxDocShare, ...extra });

describe("planKeywordQuery (#651)", () => {
  describe("dedupe", () => {
    it.each([
      {
        name: "a repeated stem keeps its first occurrence and records the rest as duplicates",
        tokens: toks("memori/memory", "split", "memori/memories"),
        terms: ["memori", "split"],
        dropped: [{ term: "memori", reason: "duplicate" }],
      },
      {
        name: "three copies drop twice",
        tokens: toks("token", "token/tokens", "token/tokenized"),
        terms: ["token"],
        dropped: [
          { term: "token", reason: "duplicate" },
          { term: "token", reason: "duplicate" },
        ],
      },
      {
        name: "no repeats drops nothing",
        tokens: toks("split", "brain"),
        terms: ["split", "brain"],
        dropped: [],
      },
    ])("$name", ({ tokens, terms, dropped }) => {
      const p = plan(tokens, 0.5, { bigrams: false });
      expect(p.terms).toEqual(terms);
      expect(p.dropped).toEqual(dropped);
    });
  });

  describe("prune by document-frequency share", () => {
    it.each([
      {
        name: "terms above the share threshold are dropped as too-common",
        max: 0.5,
        tokens: toks("how", "the", "split", "brain"),
        terms: ["how", "split", "brain"],
        dropped: [{ term: "the", reason: "too-common" }],
      },
      {
        name: "a lower threshold prunes mid-frequency words too",
        max: 0.3,
        tokens: toks("how", "the", "split", "brain"),
        terms: ["split", "brain"],
        dropped: [
          { term: "how", reason: "too-common" },
          { term: "the", reason: "too-common" },
        ],
      },
      {
        name: "a share exactly at the threshold is kept (strictly above prunes)",
        max: 0.4,
        tokens: toks("how", "brain"),
        terms: ["how", "brain"],
        dropped: [],
      },
      {
        name: "a duplicate of a too-common stem is recorded once as too-common and once as duplicate",
        max: 0.5,
        tokens: toks("the", "brain", "the"),
        terms: ["brain"],
        dropped: [
          { term: "the", reason: "too-common" },
          { term: "the", reason: "duplicate" },
        ],
      },
    ])("$name", ({ max, tokens, terms, dropped }) => {
      const p = plan(tokens, max, { bigrams: false });
      expect(p.terms).toEqual(terms);
      expect(p.dropped).toEqual(dropped);
    });

    it("reads document frequency from the stemmed body column only", () => {
      const stats = fakeStats(DF);
      planKeywordQuery(toks("the", "brain"), stats, { maxDocShare: 0.5, bigrams: false });
      expect(stats.calls).toEqual(["body_stem:the", "body_stem:brain"]);
    });

    it("never prunes on an empty index (totalDocs 0)", () => {
      const p = planKeywordQuery(toks("the", "brain"), fakeStats(DF, 0), { maxDocShare: 0.5, bigrams: false });
      expect(p.terms).toEqual(["the", "brain"]);
      expect(p.dropped).toEqual([]);
    });
  });

  describe("guards", () => {
    it.each([
      {
        name: "a one-term query is never pruned",
        tokens: toks("the"),
        terms: ["the"],
        dropped: [],
      },
      {
        name: "a one-term query after dedupe is never pruned",
        tokens: toks("the", "the"),
        terms: ["the"],
        dropped: [{ term: "the", reason: "duplicate" }],
      },
      {
        name: "when every term is too common the rarest one survives",
        tokens: toks("the", "how/whether", "of"),
        max: 0.1,
        terms: ["how"],
        dropped: [
          { term: "the", reason: "too-common" },
          { term: "of", reason: "too-common" },
        ],
      },
      {
        name: "a rarest-term tie keeps the first in query order",
        tokens: toks("of", "the"),
        max: 0.1,
        terms: ["of"],
        dropped: [{ term: "the", reason: "too-common" }],
      },
      {
        name: "a token inside a quoted span is never pruned",
        tokens: toks("[1]the", "[1]brain", "of"),
        max: 0.5,
        terms: ["the", "brain"],
        dropped: [{ term: "of", reason: "too-common" }],
      },
    ])("$name", ({ tokens, terms, dropped, max }) => {
      const p = plan(tokens, max ?? 0.5, { bigrams: false });
      expect(p.terms).toEqual(terms);
      expect(p.dropped).toEqual(dropped);
    });

    it("an empty token list plans nothing", () => {
      expect(plan([])).toEqual({ terms: [], phrases: [], dropped: [] });
    });
  });

  describe("phrase clauses", () => {
    it.each([
      {
        name: "adjacent kept stems become bigrams on the stemmed column",
        tokens: toks("token", "bucket", "split"),
        phrases: [
          { column: "body_stem", tokens: ["token", "bucket"], source: "bigram" },
          { column: "body_stem", tokens: ["bucket", "split"], source: "bigram" },
        ],
      },
      {
        name: "a pruned token breaks adjacency (no bigram spans it)",
        tokens: toks("split", "the", "brain"),
        phrases: [],
      },
      {
        name: "a repeated bigram is emitted once",
        tokens: toks("split", "brain", "split", "brain"),
        phrases: [
          { column: "body_stem", tokens: ["split", "brain"], source: "bigram" },
          { column: "body_stem", tokens: ["brain", "split"], source: "bigram" },
        ],
      },
      {
        name: "a word next to its own duplicate yields no self-bigram",
        tokens: toks("token", "token/tokens"),
        phrases: [],
      },
      {
        name: "a quoted span becomes one phrase of raw words on the body column, and no bigrams inside it",
        tokens: toks("[1]split", "[1]brain/brains", "token"),
        phrases: [{ column: "body", tokens: ["split", "brains"], source: "quoted" }],
      },
      {
        name: "a quoted span keeps its too-common words, and two spans make two phrases",
        tokens: toks("[1]split", "[1]the", "[1]brain", "[2]token", "[2]bucket/buckets"),
        phrases: [
          { column: "body", tokens: ["split", "the", "brain"], source: "quoted" },
          { column: "body", tokens: ["token", "buckets"], source: "quoted" },
        ],
      },
      {
        name: "a one-word quoted span is still a phrase on body (exact form)",
        tokens: toks("[1]memori/memory", "brain"),
        phrases: [{ column: "body", tokens: ["memory"], source: "quoted" }],
      },
    ])("$name", ({ tokens, phrases }) => {
      expect(plan(tokens).phrases).toEqual(phrases);
    });

    it("bigrams: false emits no bigrams but keeps quoted phrases", () => {
      expect(plan(toks("token", "bucket", "[1]split", "[1]brain"), 0.5, { bigrams: false }).phrases).toEqual([
        { column: "body", tokens: ["split", "brain"], source: "quoted" },
      ]);
    });
  });
});
