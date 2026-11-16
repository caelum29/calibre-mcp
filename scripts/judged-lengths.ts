// Book-length quartiles for the blind judged eval (#361, needed by #633) — STUB.

import type { BlindKey, FinalGrade, RawRecord } from "./judged-lib.js";

/** library id → book id → chunk count (book-lengths.json). */
export type BookLengths = Record<string, Record<string, number>>;

/** Shares of one set of hits per length quartile (Q1 shortest … Q4 longest). */
export interface QuartileRow {
  label: string;
  shares: [number, number, number, number];
  /** Hits in indexed books (the shares' denominator). */
  n: number;
  /** Hits in books the length file does not list. */
  unindexed: number;
}

/** One library's breakdown. */
export interface LengthBreakdown {
  library: string;
  books: number;
  cuts: [number, number, number];
  rows: QuartileRow[];
}

const todo = (): never => {
  throw new Error("not implemented (#361)");
};
export function quartileCuts(_counts: readonly number[]): [number, number, number] {
  return todo();
}
export function quartileOf(_chunks: number, _cuts: readonly [number, number, number]): 0 | 1 | 2 | 3 {
  return todo();
}
export function lengthBreakdown(
  _raws: readonly RawRecord[],
  _key: BlindKey,
  _final: ReadonlyMap<string, FinalGrade>,
  _lengths: BookLengths,
): LengthBreakdown[] {
  return todo();
}
export function renderLengthBreakdown(_b: readonly LengthBreakdown[]): string[] {
  return todo();
}
export function readBookLengths(_indexDir: string, _libraries: readonly string[]): BookLengths {
  return todo();
}
