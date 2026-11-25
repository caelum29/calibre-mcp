// One stored judgment grades at most one hit of a query (#361, PR #666 review): a wide stored range
// must not grade every hit inside it as relevant, inflating P@5 / hit@5 and pushing NDCG@5 above 1.
import { describe, expect, it } from "vitest";
import { blindRecord, gradesFor, metrics, type FinalGrade, type RawRecord } from "../../../scripts/judged-lib.js";
import {
  gradeFromStore,
  holeAt,
  idealGrades,
  ndcgAt5,
  newJudgmentsFromRun,
  uncoveredBlind,
  type JudgedRunDir,
  type StoredJudgment,
} from "../../../scripts/judged-store.js";

// one stored grade 2 over [0, 10000) of book 7, and five hybrid hits all inside it
const WIDE: StoredJudgment = {
  qid: "q",
  bookId: 7,
  charStart: 0,
  charEnd: 10_000,
  indexVersion: 4,
  rubric: 1,
  textSha256: "w",
  grade: 2,
  coverage: "E",
  judges: { A: 2, B: 2 },
  adjudicated: false,
  run: "r1",
  date: "2026-11-16T10:00:00.000Z",
};
const SPANS: [number, number][] = [
  [100, 600],
  [5000, 5500],
  [9000, 9500],
  [300, 800],
  [700, 1200],
];
const RAW: RawRecord = {
  query: {
    id: "q",
    category: "para",
    library: "L",
    scope: "library",
    target: "text",
    query: "q",
    mustCover: "m",
    expectedBooks: [],
  },
  runs: {
    hybrid: {
      isError: false,
      indexVersion: 4,
      hits: SPANS.map(([s, e]) => ({ bookId: 7, title: "B7", at: s, charEnd: e, text: `t${s}` })),
    },
  },
};
const KEY = blindRecord(RAW).key;
const hybrid = (store: readonly StoredJudgment[]) => gradesFor("q", "hybrid", KEY, gradeFromStore([RAW], store));

describe("one stored record grades at most one hit of a query", () => {
  it("grades only the best-ranked of five hits inside one stored range; the rest stay unjudged", () => {
    const list = hybrid([WIDE]);
    expect(list).toEqual([2, null, null, null, null]);
    expect(holeAt([list], 5)).toBe(0.8);
    expect(metrics([list]).p5).toBe(0.2);
  });

  it("keeps NDCG@5 at most 1 with no clamp, and throws instead of reporting more", () => {
    expect(ndcgAt5(hybrid([WIDE]), idealGrades([WIDE], "q", 4))).toBe(1);
    expect(() => ndcgAt5([2, 2], [2])).toThrow("NDCG@5 above 1");
  });

  it("pooling sends the four hits the record no longer covers to the judges", () => {
    const { blinds } = uncoveredBlind([RAW], [WIDE]);
    expect(blinds.map((b) => b.items.length)).toEqual([4]);
  });

  it("appends the four new grades (not the covered hit's) and the next grading uses each once", () => {
    const final = new Map<string, FinalGrade>(Object.keys(KEY).map((hid) => [hid, { grade: 1, coverage: "L" }]));
    const run: JudgedRunDir = {
      name: "r2",
      dir: "/runs/r2",
      queriesJson: "[]",
      raws: [RAW],
      key: KEY,
      blindText: new Map(),
      judges: new Map(),
      adjudicated: new Map(),
      judgedAt: "2026-11-17T00:00:00.000Z",
    };
    const added = newJudgmentsFromRun(run, final, [WIDE]);
    expect(added.map((r) => [r.charStart, r.charEnd]).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [300, 800],
      [700, 1200],
      [5000, 5500],
      [9000, 9500],
    ]);
    expect(hybrid([WIDE, ...added])).toEqual([2, 1, 1, 1, 1]);
    expect(newJudgmentsFromRun(run, final, [WIDE, ...added])).toEqual([]);
  });
});
