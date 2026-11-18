// Keyword-query planner (#651): turns a query's tokens into the plan the keyword half's MATCH is
// rendered from — distinct stems, minus words so common they cost a long posting list and add
// almost no ranking signal, plus phrase clauses for adjacency. Pure: term statistics come in
// through the TermStats port. Wired into the keyword half's MATCH by store/shared.ts keywordMatch.

/** The chunk_fts columns in table order (schema.ts): stemmed body, raw body, stemmed title + authors. */
export const KEYWORD_COLUMNS = ["body_stem", "body", "book_meta"] as const;

/** A chunk_fts column. */
export type KeywordColumn = (typeof KEYWORD_COLUMNS)[number];

/** Term-statistics port over the keyword index: document frequency per column. */
export interface TermStats {
  /** Number of chunks that contain `term` in `column` (document, never collection, frequency). */
  docFreq(term: string, column: KeywordColumn): number;
  /** Number of chunks in the index. */
  readonly totalDocs: number;
}

/** One query word in order: its stem, its surface form, and the quoted span it sits in, if any. */
export interface KeywordToken {
  stem: string;
  raw: string;
  /** Id of the quoted span ("…") holding the token; equal ids = same span. */
  span?: number;
}

export interface KeywordPlanOptions {
  /** Prune a term whose body_stem document-frequency share is strictly above this (0–1). */
  maxDocShare: number;
  /** Emit bigram phrase clauses for adjacent kept stems (default true). */
  bigrams?: boolean;
}

/** A phrase clause: adjacent stems on body_stem (bigram) or a quoted span's raw words on body. */
export interface KeywordPhrase {
  column: "body_stem" | "body";
  tokens: string[];
  source: "bigram" | "quoted";
}

export interface KeywordDrop {
  term: string;
  reason: "duplicate" | "too-common";
}

/** The keyword half's query plan; `dropped` feeds debug output (#650). */
export interface KeywordPlan {
  terms: string[];
  phrases: KeywordPhrase[];
  dropped: KeywordDrop[];
}

/**
 * Plan a keyword query: dedupe stems (FTS5 adds a bm25 term per repeated phrase, so restated
 * nouns over-weight), prune stems above `maxDocShare` of chunks, then build phrase clauses.
 * Guards: a one-term query is never pruned, quoted-span tokens are never pruned, and if every
 * term would be pruned the rarest survives (first in query order on a tie).
 */
export function planKeywordQuery(
  tokens: readonly KeywordToken[],
  stats: TermStats,
  opts: KeywordPlanOptions,
): KeywordPlan {
  const firsts = new Map<string, KeywordToken>();
  for (const t of tokens) if (!firsts.has(t.stem)) firsts.set(t.stem, t);
  const quoted = new Set(tokens.filter((t) => t.span !== undefined).map((t) => t.stem));
  const pruned = pruneSet([...firsts.keys()], quoted, stats, opts.maxDocShare);

  const dropped: KeywordDrop[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (seen.has(t.stem)) dropped.push({ term: t.stem, reason: "duplicate" });
    else if (pruned.has(t.stem)) dropped.push({ term: t.stem, reason: "too-common" });
    seen.add(t.stem);
  }
  const terms = [...firsts.keys()].filter((s) => !pruned.has(s));
  return { terms, phrases: phrasesOf(tokens, pruned, opts.bigrams ?? true), dropped };
}

function pruneSet(distinct: string[], quoted: ReadonlySet<string>, stats: TermStats, max: number): Set<string> {
  // a one-term query has nothing to trade off; an empty index has no statistics to trust
  if (distinct.length <= 1 || stats.totalDocs <= 0) return new Set();
  const share = new Map(distinct.map((s) => [s, stats.docFreq(s, "body_stem") / stats.totalDocs]));
  const over = distinct.filter((s) => !quoted.has(s) && (share.get(s) ?? 0) > max);
  if (over.length === distinct.length) {
    // never drop every term: the rarest one still narrows the result
    const rarest = over.reduce((a, b) => ((share.get(b) ?? 0) < (share.get(a) ?? 0) ? b : a));
    return new Set(over.filter((s) => s !== rarest));
  }
  return new Set(over);
}

function phrasesOf(tokens: readonly KeywordToken[], pruned: ReadonlySet<string>, bigrams: boolean): KeywordPhrase[] {
  const out: KeywordPhrase[] = [];
  const seenBigram = new Set<string>();
  const doneSpans = new Set<number>();
  for (const [i, t] of tokens.entries()) {
    if (t.span !== undefined) {
      // a quoted span is matched as typed: its raw words, in order, on the raw body column
      if (doneSpans.has(t.span)) continue;
      doneSpans.add(t.span);
      const words = tokens.filter((u) => u.span === t.span).map((u) => u.raw);
      out.push({ column: "body", tokens: words, source: "quoted" });
      continue;
    }
    const next = tokens[i + 1];
    if (!bigrams || next === undefined || next.span !== undefined) continue;
    // a pruned word between two kept ones breaks adjacency, so no bigram spans it
    if (pruned.has(t.stem) || pruned.has(next.stem) || t.stem === next.stem) continue;
    const key = `${t.stem} ${next.stem}`;
    if (seenBigram.has(key)) continue;
    seenBigram.add(key);
    out.push({ column: "body_stem", tokens: [t.stem, next.stem], source: "bigram" });
  }
  return out;
}
