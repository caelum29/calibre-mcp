// Judgment store for the blind judged eval (#361): one append-only JSONL of final grades per query set,
// so a later run reuses earlier grades instead of re-judging (and re-rolling judge noise) — STUB.

import type { BlindKey, BlindQuery, Coverage, FinalGrade, Grade, GradeValue, RawRecord } from "./judged-lib.js";

/** Version of the frozen judge rubric (#662); judgments graded under another version are never reused. */
export const JUDGE_RUBRIC_VERSION = 1;

/** One stored final grade: where the judged text sat, what the judges said, and which run produced it. */
export interface StoredJudgment {
  qid: string;
  bookId: number;
  charStart: number;
  charEnd: number;
  indexVersion: number;
  rubric: number;
  textSha256: string;
  grade: GradeValue;
  coverage?: Coverage;
  judges: Record<string, GradeValue>;
  adjudicated: boolean;
  run: string;
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
  text: string;
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

const todo = (): never => {
  throw new Error("not implemented (#361)");
};

export function sha256(_text: string): string {
  return todo();
}
export function querySetHash(_queriesJson: string): string {
  return todo();
}
export function storeFileName(_queriesJson: string): string {
  return todo();
}
export function matchJudgment(
  _hit: HitLocation,
  _store: readonly StoredJudgment[],
  _opts: MatchOptions = {},
): StoredJudgment | undefined {
  return todo();
}
export function pooledHits(_rec: RawRecord): PooledHit[] {
  return todo();
}
export function judgmentsFromRun(_run: JudgedRunDir, _final: ReadonlyMap<string, FinalGrade>): StoredJudgment[] {
  return todo();
}
export function newJudgments(
  _existing: readonly StoredJudgment[],
  _candidates: readonly StoredJudgment[],
  _opts: MatchOptions = {},
): StoredJudgment[] {
  return todo();
}
export function uncoveredBlind(
  _raws: readonly RawRecord[],
  _store: readonly StoredJudgment[],
  _opts: MatchOptions = {},
): { blinds: BlindQuery[]; key: BlindKey } {
  return todo();
}
export function gradeFromStore(
  _raws: readonly RawRecord[],
  _store: readonly StoredJudgment[],
  _opts: MatchOptions = {},
): Map<string, FinalGrade> {
  return todo();
}
export function holeAt(_lists: ReadonlyArray<ReadonlyArray<number | null>>, _k: number): number {
  return todo();
}
export function idealGrades(
  _store: readonly StoredJudgment[],
  _qid: string,
  _indexVersion: number,
  _opts: MatchOptions = {},
): number[] {
  return todo();
}
export function ndcgAt5(_grades: ReadonlyArray<number | null>, _ideal: readonly number[]): number {
  return todo();
}
export function readStore(_file: string): StoredJudgment[] {
  return todo();
}
export function appendJudgments(_file: string, _records: readonly StoredJudgment[]): void {
  todo();
}
export function storePathError(_storeFile: string, _queriesJson: string): string | undefined {
  return todo();
}
export function loadRunDir(_dir: string): JudgedRunDir {
  return todo();
}
export function importRun(_dir: string, _storeFile: string, _opts: MatchOptions = {}): StoredJudgment[] {
  return todo();
}
