// #358 RED stub — paired stats for `pnpm eval --compare`.

import type { EvalReport, Mode } from "./harness.js";

export interface CompareRow {
  mode: Mode;
  group: string;
  n: number;
  meanA: number;
  meanB: number;
  delta: number;
  ci: [number, number];
  p: number;
  hit1Wins: number;
  hit1Losses: number;
  signP: number;
  mde: number;
  underpowered: boolean;
  headroom: number;
}

export const signTest = (_w: number, _l: number): number => Number.NaN;
export const pairedPermutationTest = (_d: number[]): number => Number.NaN;
export const pairedBootstrapCI = (_d: number[]): [number, number] => [Number.NaN, Number.NaN];
export const minDetectableEffect = (_sd: number, _n: number): number => Number.NaN;
export const compareReports = (_a: EvalReport, _b: EvalReport): CompareRow[] => [];
export const renderCompare = (_r: CompareRow[], _a: string, _b: string): string => "";
