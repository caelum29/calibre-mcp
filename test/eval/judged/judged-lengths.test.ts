// Unit tests for the judged eval's book-length quartiles (#361, for #633): cuts over a library's
// indexed books, quartile assignment, and slot / grade shares on a constructed run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { blindRecord, type FinalGrade, type JudgedQuery, type RawRecord } from "../../../scripts/judged-lib.js";
import {
  lengthBreakdown,
  quartileCuts,
  quartileOf,
  readBookLengths,
  renderLengthBreakdown,
  type BookLengths,
} from "../../../scripts/judged-lengths.js";
import { indexFileName } from "../../../src/domain/index-steers.js";

describe("quartileCuts / quartileOf", () => {
  it("cuts at the sorted counts' 1/4, 2/4, 3/4 positions", () => {
    expect(quartileCuts([80, 10, 70, 20, 60, 30, 50, 40])).toEqual([30, 50, 70]);
    expect(quartileCuts([5, 5, 5, 5])).toEqual([5, 5, 5]);
  });
  it("puts a book in the quartile the cuts define (a cut value opens the next quartile)", () => {
    const cuts = [30, 50, 70] as const;
    expect([10, 29, 30, 49, 50, 69, 70, 1000].map((c) => quartileOf(c, cuts))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

const q = (id: string, over: Partial<JudgedQuery> = {}): JudgedQuery => ({
  id,
  category: "para",
  library: "L",
  scope: "library",
  target: "text",
  query: `query ${id}`,
  mustCover: "m",
  expectedBooks: [],
  ...over,
});
const rawOf = (query: JudgedQuery, books: number[]): RawRecord => ({
  query,
  runs: {
    hybrid: {
      isError: false,
      indexVersion: 4,
      hits: books.map((bookId, i) => ({
        bookId,
        title: `B${bookId}`,
        at: i * 1000,
        charEnd: i * 1000 + 500,
        text: `${bookId}`,
      })),
    },
  },
});
// books 1..8 have 10..80 chunks → cuts 30 / 50 / 70: Q1 = 1,2 · Q2 = 3,4 · Q3 = 5,6 · Q4 = 7,8; book 9 is not indexed
const LENGTHS: BookLengths = { L: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((b) => [String(b), b * 10])) };
const RAWS = [
  rawOf(q("p1"), [1, 3, 5, 7, 9]),
  rawOf(q("p2"), [2, 4]),
  rawOf(q("b1", { category: "book", scope: "book", bookId: 1 }), [1, 1]), // book scope: left out
  rawOf(q("f1", { category: "fig", target: "figures" }), [8]), // figures: left out
  rawOf(q("m1", { library: "M" }), [1]), // no lengths for library M: no breakdown
  rawOf(q("n1", { category: "neg" }), [8, 6, 1]),
];
const GRADES: Record<string, Array<FinalGrade["grade"] | undefined>> = {
  p1: [2, 0, 1, 2, 0],
  p2: [2, 0],
  b1: [2, 2],
  f1: [2],
  m1: [2],
  n1: [0, undefined, 0], // one negative hit unjudged: still a slot
};
const key = Object.assign({}, ...RAWS.map((r) => blindRecord(r).key));
const final = new Map<string, FinalGrade>();
for (const [hid, seen] of Object.entries(key) as Array<[string, { hybrid?: number }]>) {
  const g = GRADES[hid.slice(0, hid.lastIndexOf("#"))]![seen.hybrid! - 1];
  if (g !== undefined) final.set(hid, { grade: g });
}

describe("lengthBreakdown — library-scope text queries per length quartile", () => {
  it("reproduces hand-computed shares of slots, grade-2 hits, grade-0 hits and negatives' slots", () => {
    expect(lengthBreakdown(RAWS, key, final, LENGTHS)).toEqual([
      {
        library: "L",
        books: 8,
        cuts: [30, 50, 70],
        rows: [
          { label: "hybrid top-5 slots", shares: [2 / 6, 2 / 6, 1 / 6, 1 / 6], n: 6, unindexed: 1 },
          { label: "grade 2", shares: [2 / 3, 0, 0, 1 / 3], n: 3, unindexed: 0 },
          { label: "grade 0", shares: [0, 1, 0, 0], n: 2, unindexed: 1 },
          { label: "negatives' top-5 slots", shares: [1 / 3, 0, 1 / 3, 1 / 3], n: 3, unindexed: 0 },
        ],
      },
    ]);
  });
  it("renders one table per library", () => {
    expect(renderLengthBreakdown(lengthBreakdown(RAWS, key, final, LENGTHS))).toEqual([
      "",
      "**Book-length quartiles — L** (library-scope text queries; 8 indexed books, chunk cuts 30 / 50 / 70)",
      "",
      "| set | Q1 short | Q2 | Q3 | Q4 long | n | unindexed |",
      "|---|---|---|---|---|---|---|",
      "| hybrid top-5 slots | 33% | 33% | 17% | 17% | 6 | 1 |",
      "| grade 2 | 67% | 0% | 0% | 33% | 3 | 0 |",
      "| grade 0 | 0% | 100% | 0% | 0% | 2 | 1 |",
      "| negatives' top-5 slots | 33% | 0% | 33% | 33% | 3 | 0 |",
    ]);
  });
  it("gives zero shares to a set with no indexed hits", () => {
    const [b] = lengthBreakdown([rawOf(q("p9"), [9])], blindRecord(rawOf(q("p9"), [9])).key, new Map(), LENGTHS);
    expect(b!.rows[0]).toEqual({ label: "hybrid top-5 slots", shares: [0, 0, 0, 0], n: 0, unindexed: 1 });
  });
});

describe("readBookLengths — chunks per book, read-only from the index store", () => {
  it("reads books.chunk_count of each library that has an index file", () => {
    const dir = mkdtempSync(join(tmpdir(), "judged-lengths-"));
    try {
      const db = new DatabaseSync(join(dir, indexFileName("My_Lib")));
      db.exec("CREATE TABLE books (book_id INTEGER PRIMARY KEY, title TEXT, chunk_count INTEGER)");
      db.exec("INSERT INTO books VALUES (1, 'a', 10), (2, 'b', 25)");
      db.close();
      expect(readBookLengths(dir, ["My_Lib", "Missing"])).toEqual({ My_Lib: { "1": 10, "2": 25 } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
