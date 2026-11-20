// Judgment store for the blind judged eval: one append-only JSONL of final grades per query set
// (docs/dev/evals/judgments/<12 hex>.jsonl, local like the run dirs), so a later run reuses earlier
// grades instead of re-judging and re-rolling judge noise, and a hit nobody judged stays explicitly
// unjudged (null) instead of silently irrelevant. Matching rules + NDCG@5 / Hole@k live here — #361

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  blindRecord,
  isDispute,
  resolveGrades,
  type BlindKey,
  type BlindQuery,
  type Coverage,
  type FinalGrade,
  type Grade,
  type GradeValue,
  type RawRecord,
} from "./judged-lib.js";

/** Version of the frozen judge rubric (#662); bump it with any rubric change — older grades then never match. */
export const JUDGE_RUBRIC_VERSION = 1;

/** One stored final grade: where the judged text sat, what the judges said, and which run produced it. */
export interface StoredJudgment {
  qid: string;
  bookId: number;
  /** Text: passage start; figures: the figure offset (then charEnd = charStart). */
  charStart: number;
  charEnd: number;
  indexVersion: number;
  rubric: number;
  /** sha256 of the exact text the judges read. */
  textSha256: string;
  grade: GradeValue;
  coverage?: Coverage;
  /** Each judge's raw grade (adjudicator excluded). */
  judges: Record<string, GradeValue>;
  adjudicated: boolean;
  /** Run directory name the grade came from. */
  run: string;
  /** When that run was judged (ISO). */
  date: string;
}

/** What identifies a hit for matching against the store. */
export interface HitLocation {
  qid: string;
  bookId: number;
  charStart: number;
  charEnd: number;
  indexVersion: number;
  textSha256: string;
}

/** Matching knobs: strictText = the judged-text hash must be equal too; rubric defaults to the current one. */
export interface MatchOptions {
  strictText?: boolean;
  rubric?: number;
}

/** A pooled blind item of one query with the location it came from (undefined when the run lacks one). */
export interface PooledHit {
  hid: string;
  /** Judge-facing text, as blindRecord shows it now. */
  text: string;
  /** Best list position: hybrid rank, else 1000 + keyword rank (who gets a shared record first). */
  rank: number;
  location?: HitLocation;
}

/** A judged run directory as judged-dump / the judges / judged-score leave it. */
export interface JudgedRunDir {
  name: string;
  dir: string;
  queriesJson: string;
  raws: RawRecord[];
  key: BlindKey;
  /** hid → the exact text the judges read (blind/*.json); empty when no batches were written. */
  blindText: Map<string, string>;
  /** judge name → hid → grade (adjudicator excluded). */
  judges: Map<string, Map<string, Grade>>;
  adjudicated: Map<string, Grade>;
  /** Latest judgement-file mtime (ISO): when the run was judged. */
  judgedAt?: string;
}

/** Hex sha256 of a UTF-8 string. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * sha256 of the query set, over its canonical JSON: re-indenting queries.json keeps the store,
 * while any content change (query text case or whitespace included) is a new query set.
 */
export function querySetHash(queriesJson: string): string {
  return sha256(JSON.stringify(JSON.parse(queriesJson)));
}

/** Store file name of a query set: `<first 12 hex of its hash>.jsonl`. */
export function storeFileName(queriesJson: string): string {
  return `${querySetHash(queriesJson).slice(0, 12)}.jsonl`;
}

/** Refusal when a store file is not this query set's (qids of two query sets would collide). */
export function storePathError(storeFile: string, queriesJson: string): string | undefined {
  const want = storeFileName(queriesJson);
  return basename(storeFile) === want
    ? undefined
    : `store ${storeFile} belongs to another query set: this run's store is ${want}`;
}

/**
 * Characters two locations share when they count as the same hit, else undefined. Text ranges must
 * overlap by at least half the shorter range (chunk boundaries move between variants and per-book
 * re-indexes); a figure is a point (charStart = charEnd) and matches only the equal point.
 */
function sharedChars(a: { charStart: number; charEnd: number }, b: { charStart: number; charEnd: number }) {
  const aPoint = a.charEnd === a.charStart;
  const bPoint = b.charEnd === b.charStart;
  if (aPoint || bPoint) return aPoint && bPoint && a.charStart === b.charStart ? 0 : undefined;
  const overlap = Math.min(a.charEnd, b.charEnd) - Math.max(a.charStart, b.charStart);
  const shorter = Math.min(a.charEnd - a.charStart, b.charEnd - b.charStart);
  return overlap > 0 && 2 * overlap >= shorter ? overlap : undefined;
}

/**
 * The stored judgment that grades this hit, if any. Query, book, indexVersion (offsets are valid only
 * within one index generation) and rubric version must be equal, the spans must match; with strictText
 * the judged text too. Several matches: the larger overlap, then the newer date, then the closer span
 * (so a run's own record wins over an overlapping neighbour's), then the later record.
 */
export function matchJudgment(
  hit: HitLocation,
  store: readonly StoredJudgment[],
  opts: MatchOptions = {},
): StoredJudgment | undefined {
  return candidates(hit, store, opts).sort(preferred)[0]?.rec;
}

/** A stored record that matches a hit, with what ranks it among the hit's other matches. */
interface Candidate {
  rec: StoredJudgment;
  /** Position in the store file (a later record wins a full tie). */
  index: number;
  overlap: number;
  drift: number;
}

function candidates(hit: HitLocation, store: readonly StoredJudgment[], opts: MatchOptions): Candidate[] {
  const rubric = opts.rubric ?? JUDGE_RUBRIC_VERSION;
  const out: Candidate[] = [];
  store.forEach((rec, index) => {
    if (rec.qid !== hit.qid || rec.bookId !== hit.bookId || rec.indexVersion !== hit.indexVersion) return;
    if (rec.rubric !== rubric || (opts.strictText && rec.textSha256 !== hit.textSha256)) return;
    const overlap = sharedChars(rec, hit);
    if (overlap === undefined) return;
    const drift = Math.abs(rec.charStart - hit.charStart) + Math.abs(rec.charEnd - hit.charEnd);
    out.push({ rec, index, overlap, drift });
  });
  return out;
}

/** Larger overlap, then newer date, then closer span, then later record. */
const preferred = (x: Candidate, y: Candidate) =>
  y.overlap - x.overlap ||
  (x.rec.date === y.rec.date ? 0 : x.rec.date > y.rec.date ? -1 : 1) ||
  x.drift - y.drift ||
  y.index - x.index;

/**
 * Which stored record grades which pooled hit of one query. One record grades at most ONE hit: a wide
 * stored range must not mark every hit inside it relevant (inflating P@5 / hit@5, NDCG@5 above 1).
 * Greedy over all (hit, record) matches in the matching preference order, the better-ranked hit first
 * on a full tie; a hit whose matches are all taken stays unjudged, so pooling sends it to the judges.
 */
function assign(rec: RawRecord, store: readonly StoredJudgment[], opts: MatchOptions): Map<string, StoredJudgment> {
  const pairs = pooledHits(rec).flatMap((p) =>
    p.location ? candidates(p.location, store, opts).map((c) => ({ ...c, hid: p.hid, rank: p.rank })) : [],
  );
  pairs.sort((x, y) => preferred(x, y) || x.rank - y.rank);
  const out = new Map<string, StoredJudgment>();
  const taken = new Set<number>();
  for (const p of pairs) {
    if (out.has(p.hid) || taken.has(p.index)) continue;
    out.set(p.hid, p.rec);
    taken.add(p.index);
  }
  return out;
}

/** Every pooled blind item of one query, located by the mode run it first appeared in. */
export function pooledHits(rec: RawRecord): PooledHit[] {
  const { blind, key } = blindRecord(rec);
  return blind.items.map((item): PooledHit => {
    const seen = key[item.hid]!;
    const mode = seen.hybrid !== undefined ? "hybrid" : "keyword";
    const run = rec.runs[mode]!;
    const hit = run.hits[seen[mode]! - 1]!;
    // no index generation or end offset (pre-#662 runs): the hit can be judged but never stored or reused;
    // a description hit (#631) is stored as the point -1 of its book
    const located = hit.from === "description" || (hit.charEnd !== undefined && hit.at >= 0);
    const location =
      run.indexVersion === undefined || hit.charEnd === undefined || !located
        ? undefined
        : {
            qid: rec.query.id,
            bookId: hit.bookId,
            charStart: hit.at,
            charEnd: hit.charEnd,
            indexVersion: run.indexVersion,
            textSha256: sha256(item.text),
          };
    const rank = seen.hybrid ?? 1000 + seen.keyword!;
    return { hid: item.hid, text: item.text, rank, ...(location ? { location } : {}) };
  });
}

/** Store records for a run's final grades (one per graded, located blind item), hashing the text the judges read. */
export function judgmentsFromRun(run: JudgedRunDir, final: ReadonlyMap<string, FinalGrade>): StoredJudgment[] {
  return [...judgmentsByHid(run, final).values()];
}

function judgmentsByHid(run: JudgedRunDir, final: ReadonlyMap<string, FinalGrade>): Map<string, StoredJudgment> {
  const judgeNames = [...run.judges.keys()];
  const out = new Map<string, StoredJudgment>();
  for (const rec of run.raws) {
    for (const p of pooledHits(rec)) {
      const f = final.get(p.hid);
      if (!f || !p.location) continue;
      const raw = judgeNames.map((n) => run.judges.get(n)!.get(p.hid));
      const judges = Object.fromEntries(judgeNames.flatMap((n, i) => (raw[i] ? [[n, raw[i].grade]] : [])));
      const [a, b] = raw;
      const read = run.blindText.get(p.hid);
      out.set(p.hid, {
        ...p.location,
        ...(read !== undefined ? { textSha256: sha256(read) } : {}),
        rubric: JUDGE_RUBRIC_VERSION,
        grade: f.grade,
        ...(f.coverage ? { coverage: f.coverage } : {}),
        judges,
        // the judges' shared grade is final unless they disputed it (or one never graded it)
        adjudicated: !(a && b && !isDispute(a, b)),
        run: run.name,
        date: run.judgedAt ?? "",
      });
    }
  }
  return out;
}

/**
 * Record-level check: candidates no existing record matches. It ignores the one-record-one-hit rule
 * (a candidate inside a record another hit holds counts as covered), so runs go through
 * {@link newJudgmentsFromRun}; this stays for comparing two record lists.
 */
export function newJudgments(
  existing: readonly StoredJudgment[],
  candidates: readonly StoredJudgment[],
  opts: MatchOptions = {},
): StoredJudgment[] {
  return candidates.filter((c) => !matchJudgment(c, existing, { ...opts, rubric: c.rubric }));
}

/** Final grade of every pooled hit the store covers; hits it does not cover are absent (unjudged). */
export function gradeFromStore(
  raws: readonly RawRecord[],
  store: readonly StoredJudgment[],
  opts: MatchOptions = {},
): Map<string, FinalGrade> {
  const out = new Map<string, FinalGrade>();
  for (const rec of raws)
    for (const [hid, m] of assign(rec, store, opts))
      out.set(hid, m.coverage ? { grade: m.grade, coverage: m.coverage } : { grade: m.grade });
  return out;
}

/**
 * Blind batches holding only the hits the store does not cover (incremental pooling); the key still
 * maps every pooled item, so scoring sees the whole run. A query with nothing new is left out.
 */
export function uncoveredBlind(
  raws: readonly RawRecord[],
  store: readonly StoredJudgment[],
  opts: MatchOptions = {},
): { blinds: BlindQuery[]; key: BlindKey } {
  const key: BlindKey = {};
  const blinds: BlindQuery[] = [];
  for (const rec of raws) {
    const b = blindRecord(rec);
    Object.assign(key, b.key);
    const covered = assign(rec, store, opts);
    const items = b.blind.items.filter((i) => !covered.has(i.hid));
    if (items.length) blinds.push({ ...b.blind, items });
  }
  return { blinds, key };
}

/** Share of the top-k hits that are unjudged (null), over the hits present; 0 when there are none. */
export function holeAt(lists: ReadonlyArray<ReadonlyArray<number | null>>, k: number): number {
  const top = lists.flatMap((l) => l.slice(0, k));
  return top.length ? top.filter((g) => g === null).length / top.length : 0;
}

/** The best five stored grades of a query at one indexVersion (−1 counts as 0): NDCG@5's ideal ranking. */
export function idealGrades(
  store: readonly StoredJudgment[],
  qid: string,
  indexVersion: number,
  opts: MatchOptions = {},
): number[] {
  const rubric = opts.rubric ?? JUDGE_RUBRIC_VERSION;
  return store
    .filter((r) => r.qid === qid && r.indexVersion === indexVersion && r.rubric === rubric)
    .map((r) => Math.max(0, r.grade))
    .sort((a, b) => b - a)
    .slice(0, 5);
}

const dcg5 = (grades: ReadonlyArray<number | null>) =>
  grades.slice(0, 5).reduce<number>((s, g, i) => s + (g !== null && g > 0 ? 2 ** g - 1 : 0) / Math.log2(i + 2), 0);

/** NDCG@5: gain 2^grade − 1 (unjudged / −1 / 0 → 0), discount log2(rank + 1), over the ideal grades. */
export function ndcgAt5(grades: ReadonlyArray<number | null>, ideal: readonly number[]): number {
  const best = dcg5([...ideal].sort((a, b) => b - a));
  const ndcg = best === 0 ? 0 : dcg5(grades) / best;
  // grades come from distinct stored records (assign), so this only trips on a wrong ideal: fail loudly
  if (ndcg > 1 + 1e-9) throw new Error(`NDCG@5 above 1 (${ndcg}): the ideal ranking is missing grades the list has`);
  return ndcg;
}

/** Records of a store file (empty when it does not exist yet). */
export function readStore(file: string): StoredJudgment[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as StoredJudgment);
}

/** Append records to a store file; existing lines are never touched. */
export function appendJudgments(file: string, records: readonly StoredJudgment[]): void {
  if (records.length) appendFileSync(file, records.map((r) => `${JSON.stringify(r)}\n`).join(""));
}

const readJsonl = <T>(file: string): T[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
const jsonFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => n.endsWith(".json"))
        .sort()
    : [];

/** Load a judged run dir: queries, raw hits, key, the blind batches the judges read and their grades. */
export function loadRunDir(dir: string): JudgedRunDir {
  const blindText = new Map<string, string>();
  for (const f of jsonFiles(join(dir, "blind")))
    for (const q of JSON.parse(readFileSync(join(dir, "blind", f), "utf8")) as BlindQuery[])
      for (const item of q.items) blindText.set(item.hid, item.text);
  // judgements/<judge>-batch-NN.json and adjudicated-batch-NN.json; other files there (human.json
  // calibration labels, #659) are not judge output
  const jdir = join(dir, "judgements");
  const byJudge = new Map<string, Map<string, Grade>>();
  let judgedMs = 0;
  for (const f of jsonFiles(jdir).filter((n) => /-batch-\d+\.json$/.test(n))) {
    const name = f.replace(/-batch-\d+\.json$/, "");
    const m = byJudge.get(name) ?? new Map<string, Grade>();
    for (const g of JSON.parse(readFileSync(join(jdir, f), "utf8")) as Grade[]) m.set(g.hid, g);
    byJudge.set(name, m);
    judgedMs = Math.max(judgedMs, statSync(join(jdir, f)).mtimeMs);
  }
  const adjudicated = byJudge.get("adjudicated") ?? new Map<string, Grade>();
  byJudge.delete("adjudicated");
  const judges = new Map([...byJudge.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return {
    name: basename(dir),
    dir,
    queriesJson: readFileSync(join(dir, "queries.json"), "utf8"),
    raws: readJsonl<RawRecord>(join(dir, "raw-hits.jsonl")),
    key: JSON.parse(readFileSync(join(dir, "blind-key.json"), "utf8")) as BlindKey,
    blindText,
    judges,
    adjudicated,
    ...(judgedMs ? { judgedAt: new Date(judgedMs).toISOString() } : {}),
  };
}

/** Final grades of a run's judged items: the hids the judges graded (or every key item without batches). */
export function resolveRun(run: JudgedRunDir) {
  if (run.judges.size !== 2)
    throw new Error(
      `expected 2 judges in ${join(run.dir, "judgements")}, found: ${[...run.judges.keys()].join(", ") || "none"}`,
    );
  const sent = run.blindText.size ? [...run.blindText.keys()] : Object.keys(run.key);
  const [a, b] = [...run.judges.values()] as [Map<string, Grade>, Map<string, Grade>];
  return resolveGrades(sent, a, b, run.adjudicated);
}

/** --import: seed the store from an already judged run; returns the records appended (none already covered). */
export function importRun(dir: string, storeFile: string, opts: MatchOptions = {}): StoredJudgment[] {
  const run = loadRunDir(dir);
  const added = newJudgmentsFromRun(run, resolveRun(run).final, readStore(storeFile), opts);
  appendJudgments(storeFile, added);
  return added;
}

/**
 * A run's final grades the existing store does not already hold: the hits the store's records are NOT
 * assigned to (the same one-record-one-hit assignment pooling used to pick what the judges saw), so a
 * hit that shared a record with a neighbour gets its own record once judged.
 */
export function newJudgmentsFromRun(
  run: JudgedRunDir,
  final: ReadonlyMap<string, FinalGrade>,
  existing: readonly StoredJudgment[],
  opts: MatchOptions = {},
): StoredJudgment[] {
  const covered = new Set(run.raws.flatMap((rec) => [...assign(rec, existing, opts).keys()]));
  return [...judgmentsByHid(run, final)].filter(([hid]) => !covered.has(hid)).map(([, r]) => r);
}
