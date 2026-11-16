// Book-length quartiles for the blind judged eval: where hybrid top-5 slots, grade-2 hits, grade-0
// hits and negatives' slots fall by book length (chunks), cuts over all indexed books of a library.
// A long-book bias shows up as Q4 holding more slots than relevant hits. Replaces the one-off
// lenbias.py of the 2026-11-13 run (#361, needed by #633).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { indexFileName, readBookChunkCounts } from "../src/semantic/store/schema.js";
import { gradesFor, type BlindKey, type FinalGrade, type RawRecord } from "./judged-lib.js";

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

/** Quartile cuts: the sorted chunk counts at positions ⌊N·i/4⌋ for i = 1, 2, 3 (lenbias.py's rule). */
export function quartileCuts(counts: readonly number[]): [number, number, number] {
  const s = [...counts].sort((a, b) => a - b);
  const at = (i: number) => s[Math.floor((s.length * i) / 4)]!;
  return [at(1), at(2), at(3)];
}

/** 0-based quartile of a book: how many cuts its chunk count reaches. */
export function quartileOf(chunks: number, cuts: readonly [number, number, number]): 0 | 1 | 2 | 3 {
  return cuts.filter((c) => chunks >= c).length as 0 | 1 | 2 | 3;
}

/** Library-scope text queries: book scope ranks one book's passages and figures rank figures, not books. */
const isLibraryText = (r: RawRecord) => r.query.scope === "library" && (r.query.target ?? "text") === "text";

function row(label: string, books: number[], lengths: Record<string, number>, cuts: [number, number, number]) {
  const counts = [0, 0, 0, 0];
  let unindexed = 0;
  for (const b of books) {
    const c = lengths[String(b)];
    if (c === undefined) unindexed += 1;
    else counts[quartileOf(c, cuts)]! += 1;
  }
  const n = counts.reduce((s, x) => s + x, 0);
  const shares = counts.map((x) => (n ? x / n : 0)) as [number, number, number, number];
  return { label, shares, n, unindexed };
}

/** Per library with a length file: shares of hybrid top-5 slots, grade-2 and grade-0 hits, negatives' slots. */
export function lengthBreakdown(
  raws: readonly RawRecord[],
  key: BlindKey,
  final: ReadonlyMap<string, FinalGrade>,
  lengths: BookLengths,
): LengthBreakdown[] {
  const out: LengthBreakdown[] = [];
  const libraries = [...new Set(raws.filter(isLibraryText).map((r) => r.query.library))];
  for (const library of libraries) {
    const lens = lengths[library];
    if (!lens) continue;
    const cuts = quartileCuts(Object.values(lens));
    const inLib = raws.filter(
      (r) => isLibraryText(r) && r.query.library === library && r.runs.hybrid && !r.runs.hybrid.isError,
    );
    // top-5 hybrid hits with their grade (null = unjudged: a slot, never a grade-2 or grade-0 hit)
    const slots = (rs: RawRecord[]) =>
      rs.flatMap((r) => {
        const grades = gradesFor(r.query.id, "hybrid", key, final);
        return r.runs.hybrid!.hits.slice(0, 5).map((h, i) => ({ book: h.bookId, grade: grades[i] ?? null }));
      });
    const pos = slots(inLib.filter((r) => r.query.category !== "neg"));
    const neg = slots(inLib.filter((r) => r.query.category === "neg"));
    out.push({
      library,
      books: Object.keys(lens).length,
      cuts,
      rows: [
        row(
          "hybrid top-5 slots",
          pos.map((s) => s.book),
          lens,
          cuts,
        ),
        row(
          "grade 2",
          pos.filter((s) => s.grade === 2).map((s) => s.book),
          lens,
          cuts,
        ),
        row(
          "grade 0",
          pos.filter((s) => s.grade === 0).map((s) => s.book),
          lens,
          cuts,
        ),
        row(
          "negatives' top-5 slots",
          neg.map((s) => s.book),
          lens,
          cuts,
        ),
      ],
    });
  }
  return out;
}

const pct = (x: number) => `${Math.round(100 * x)}%`;

/** Report lines (one table per library). */
export function renderLengthBreakdown(breakdowns: readonly LengthBreakdown[]): string[] {
  return breakdowns.flatMap((b) => [
    "",
    `**Book-length quartiles — ${b.library}** (library-scope text queries; ${b.books} indexed books, chunk cuts ${b.cuts.join(" / ")})`,
    "",
    "| set | Q1 short | Q2 | Q3 | Q4 long | n | unindexed |",
    "|---|---|---|---|---|---|---|",
    ...b.rows.map((r) => `| ${r.label} | ${r.shares.map(pct).join(" | ")} | ${r.n} | ${r.unindexed} |`),
  ]);
}

/** Chunks per book of each library's index (books.chunk_count), opened read-only; libraries without an index are left out. */
export function readBookLengths(indexDir: string, libraries: readonly string[]): BookLengths {
  const out: BookLengths = {};
  for (const lib of libraries) {
    const file = join(indexDir, indexFileName(lib));
    if (!existsSync(file)) continue;
    out[lib] = Object.fromEntries([...readBookChunkCounts(file)].map(([id, n]) => [String(id), n]));
  }
  return out;
}
