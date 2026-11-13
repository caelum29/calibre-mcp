// Pure helpers for the blind judged semantic-search eval: turn a tool result into raw hits,
// blind them (hybrid + keyword pooled, deduped, shuffled, scores stripped) so a separate judge
// can't tell which mode or rank produced a hit, then score the judges' grades back per mode.
// No I/O here — judged-dump.ts / judged-score.ts own the files. — #602

/** A pre-registered query (queries.json of a judged run). */
export interface JudgedQuery {
  id: string;
  category: string;
  library: string;
  scope: "library" | "book";
  bookId?: number | null;
  target?: "text" | "figures";
  query: string;
  mustCover: string;
  expectedBooks: Array<{ id: number; title: string }>;
}

/** One hit as the tool returned it, with the location that identifies it across modes. */
export interface RawHit {
  bookId: number;
  title: string;
  /** Passage start (text) or figure marker offset (figures). */
  at: number;
  /** What the judge reads: the fenced snippet / passage body / caption + context. */
  text: string;
  cosine?: number;
  rerankScore?: number;
}

/** One mode's run of one query. */
export interface RawRun {
  isError: boolean;
  error?: string;
  lowConfidence?: boolean;
  maxScore?: number;
  maxRerank?: number;
  timings?: Record<string, number>;
  hits: RawHit[];
}

/** raw-hits.jsonl line: the query plus every mode that ran for it. */
export interface RawRecord {
  query: JudgedQuery;
  runs: Partial<Record<"hybrid" | "keyword", RawRun>>;
}

/** A hit as the judge sees it: an opaque id, no mode, rank or score. */
export interface BlindItem {
  hid: string;
  title: string;
  text: string;
}

/** One query in a blind batch file. */
export interface BlindQuery {
  qid: string;
  query: string;
  mustCover: string;
  items: BlindItem[];
}

/** Unblinding key: blind item id → where it appeared (1-based rank per mode). */
export type BlindKey = Record<string, Partial<Record<"hybrid" | "keyword", number>>>;

/** A judge's grade for one blind item. */
export interface Grade {
  qid: string;
  hid: string;
  grade: 0 | 1 | 2;
  reason?: string;
}

// keyword control runs only where meaning should beat lexical match (the pass's protocol)
export const KEYWORD_CATEGORIES = new Set(["para", "concept", "problem", "xling"]);

interface StructuredHit {
  bookId?: number;
  title?: string;
  charStart?: number;
  charOffset?: number;
  snippet?: string;
  body?: string;
  caption?: string;
  contextSnippet?: string;
  cosine?: number;
  rerankScore?: number;
}

/** Normalize one tool result (library results / book passages / figures) into a RawRun. */
export function toRawRun(
  structured: Record<string, unknown> | undefined,
  isError: boolean,
  errorText: string,
  q: Pick<JudgedQuery, "bookId">,
): RawRun {
  if (isError || !structured) return { isError: true, error: errorText.slice(0, 500), hits: [] };
  const list = (structured.results ?? structured.passages ?? structured.figures ?? []) as StructuredHit[];
  const hits = list.map((h): RawHit => ({
    bookId: h.bookId ?? q.bookId ?? -1,
    title: h.title ?? "",
    at: h.charStart ?? h.charOffset ?? -1,
    text: h.snippet ?? h.body ?? [h.caption, h.contextSnippet].filter(Boolean).join("\n--- context ---\n"),
    ...(h.cosine !== undefined ? { cosine: h.cosine } : {}),
    ...(h.rerankScore !== undefined ? { rerankScore: h.rerankScore } : {}),
  }));
  const num = (k: string) => (typeof structured[k] === "number" ? (structured[k] as number) : undefined);
  const timings = structured.timings as Record<string, number> | undefined;
  return {
    isError: false,
    lowConfidence: structured.lowConfidence === true,
    ...(num("maxScore") !== undefined ? { maxScore: num("maxScore") } : {}),
    ...(num("maxRerank") !== undefined ? { maxRerank: num("maxRerank") } : {}),
    ...(timings ? { timings } : {}),
    hits,
  };
}

/** FNV-1a: a stable seed so the same run always shuffles the same way (reproducible blinding). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Pool every mode's hits for one query, dedupe by (book, location), shuffle by a seeded hash,
 * and assign opaque ids. Returns the judge-facing query and the unblinding key entries.
 */
export function blindRecord(rec: RawRecord): { blind: BlindQuery; key: BlindKey } {
  const pooled = new Map<string, { hit: RawHit; seen: Partial<Record<"hybrid" | "keyword", number>> }>();
  for (const mode of ["hybrid", "keyword"] as const) {
    rec.runs[mode]?.hits.forEach((hit, i) => {
      const loc = `${hit.bookId}@${hit.at}`;
      const entry = pooled.get(loc) ?? { hit, seen: {} };
      entry.seen[mode] = i + 1;
      pooled.set(loc, entry);
    });
  }
  const qid = rec.query.id;
  const ordered = [...pooled.entries()].sort(([a], [b]) => hash(`${qid}|${a}`) - hash(`${qid}|${b}`));
  const key: BlindKey = {};
  const items = ordered.map(([, { hit, seen }], i): BlindItem => {
    const hid = `${qid}#${i + 1}`;
    key[hid] = seen;
    return { hid, title: hit.title, text: hit.text };
  });
  return { blind: { qid, query: rec.query.query, mustCover: rec.query.mustCover, items }, key };
}

/** Cohen's kappa over paired categorical grades (1 = perfect agreement, 0 = chance). */
export function cohenKappa(pairs: Array<[number, number]>): number {
  if (pairs.length === 0) return Number.NaN;
  const cats = [...new Set(pairs.flat())];
  const agree = pairs.filter(([a, b]) => a === b).length / pairs.length;
  const share = (side: 0 | 1, c: number) => pairs.filter((p) => p[side] === c).length / pairs.length;
  const chance = cats.reduce((s, c) => s + share(0, c) * share(1, c), 0);
  return chance === 1 ? 1 : (agree - chance) / (1 - chance);
}

/** Grades in emitted order for one mode of one query (missing judgement → null). */
export function gradesFor(
  qid: string,
  mode: "hybrid" | "keyword",
  key: BlindKey,
  final: ReadonlyMap<string, number>,
): Array<number | null> {
  const ranked = Object.entries(key)
    .filter(([hid, seen]) => hid.startsWith(`${qid}#`) && seen[mode] !== undefined)
    .sort(([, a], [, b]) => (a[mode] ?? 0) - (b[mode] ?? 0));
  return ranked.map(([hid]) => final.get(hid) ?? null);
}

/** Per-category metrics in the same shape as the inline judged pass. */
export interface CategoryMetrics {
  n: number;
  hit1: number;
  hit3: number;
  hit5: number;
  totalMiss: number;
  mrr: number;
  p5: number;
}

/** hit@k / MRR / P@5 over lists of grades (a 2 = answers the query). */
export function metrics(lists: Array<Array<number | null>>): CategoryMetrics {
  const n = lists.length;
  const has2 = (l: Array<number | null>, k: number) => l.slice(0, k).includes(2);
  const share = (f: (l: Array<number | null>) => boolean) => (n ? lists.filter(f).length / n : 0);
  const rr = (l: Array<number | null>) => {
    const i = l.indexOf(2);
    return i < 0 ? 0 : 1 / (i + 1);
  };
  return {
    n,
    hit1: share((l) => has2(l, 1)),
    hit3: share((l) => has2(l, 3)),
    hit5: share((l) => has2(l, 5)),
    totalMiss: share((l) => !l.some((g) => g !== null && g > 0)),
    mrr: n ? lists.reduce((s, l) => s + rr(l), 0) / n : 0,
    p5: n ? lists.reduce((s, l) => s + l.slice(0, 5).filter((g) => g === 2).length / 5, 0) / n : 0,
  };
}

/** Median and worst of a list of numbers (undefined when empty). */
export function medianAndMax(xs: number[]): { median: number; max: number } | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return { median: s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2, max: s[s.length - 1]! };
}
