// Run-versus-run comparison for the blind judged eval (#361) — STUB.

import type { RawRecord, BlindKey } from "./judged-lib.js";
import type { MatchOptions, StoredJudgment } from "./judged-store.js";

/** What compare needs of one judged run. */
export interface CompareRun {
  name: string;
  dir: string;
  queriesJson: string;
  raws: RawRecord[];
  key: BlindKey;
}

/** One paired row: run B against run A, one mode, overall or one category. */
export interface JudgedCompareRow {
  mode: "hybrid" | "keyword";
  group: string;
  n: number;
  ndcgA: number;
  ndcgACi: [number, number];
  ndcgB: number;
  ndcgBCi: [number, number];
  hit5A: number;
  hit5ACi: [number, number];
  hit5B: number;
  hit5BCi: [number, number];
  delta: number;
  ci: [number, number];
  p: number;
  hit5Wins: number;
  hit5Losses: number;
  signP: number;
  mde: number;
  underpowered: boolean;
}

/** Header facts that make a comparison reproducible. */
export interface CompareHeader {
  a: string;
  b: string;
  querySetSha256: string;
  storeFile: string;
  storeSha256: string;
  records: number;
}

export function compareRefusal(
  _a: CompareRun,
  _b: CompareRun,
  _store: readonly StoredJudgment[],
  _storeFile: string,
  _opts: MatchOptions = {},
): string | undefined {
  throw new Error("not implemented (#361)");
}
export function compareJudgedRuns(
  _a: CompareRun,
  _b: CompareRun,
  _store: readonly StoredJudgment[],
  _opts: MatchOptions = {},
): JudgedCompareRow[] {
  throw new Error("not implemented (#361)");
}
export function renderJudgedCompare(_rows: readonly JudgedCompareRow[], _h: CompareHeader): string {
  throw new Error("not implemented (#361)");
}
