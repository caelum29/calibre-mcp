// Unit tests for the judged run-versus-run comparison (#361): refusals (query set, holes), paired rows
// built from the stats.ts primitives on hand-derived NDCG@5 / hit@5 values, reproducible output.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blindRecord, type JudgedQuery, type RawRecord } from "../../../scripts/judged-lib.js";
import {
  compareJudgedRuns,
  compareRefusal,
  renderJudgedCompare,
  type CompareRun,
  type JudgedCompareRow,
} from "../../../scripts/judged-compare-lib.js";
import { importRun, querySetHash, sha256, storeFileName, type StoredJudgment } from "../../../scripts/judged-store.js";
import {
  mean,
  minDetectableEffect,
  pairedBootstrapCI,
  pairedPermutationTest,
  sampleSd,
  signTest,
} from "../retrieval/stats.js";

const REPO = join(import.meta.dirname, "..", "..", "..");
const FIXTURE = join(import.meta.dirname, "fixtures", "blind-run");

const q = (id: string, category: string): JudgedQuery => ({
  id,
  category,
  library: "L",
  scope: "library",
  target: "text",
  query: `query ${id}`,
  mustCover: "m",
  expectedBooks: [],
});
const hitOf = (bookId: number) => ({
  bookId,
  title: `B${bookId}`,
  at: bookId * 1000,
  charEnd: bookId * 1000 + 500,
  text: `text of book ${bookId}`,
});
const QUERIES = [q("q1", "para"), q("q2", "para"), q("q3", "concept"), q("q4", "concept"), q("neg-01", "neg")];
const rawOf = (query: JudgedQuery, books: number[], kwBooks?: number[]): RawRecord => ({
  query,
  runs: {
    hybrid: { isError: false, indexVersion: 4, hits: books.map(hitOf) },
    ...(kwBooks ? { keyword: { isError: false, indexVersion: 4, hits: kwBooks.map(hitOf) } } : {}),
  },
});
const runOf = (name: string, lists: number[][], queries: JudgedQuery[] = QUERIES): CompareRun => {
  // q1 has a keyword run in A only: a mode present in one run is never compared (nor hole-checked)
  const raws = queries.map((query, i) => rawOf(query, lists[i]!, name === "A" && i === 0 ? [5] : undefined));
  const key = Object.assign({}, ...raws.map((r) => blindRecord(r).key));
  return { name, dir: `/runs/${name}`, queriesJson: JSON.stringify(queries), raws, key };
};
// every positive query: book 1 answers it (2), book 2 partly (1), book 3 not (0); negatives have no grades
const judged = (qid: string, bookId: number, grade: 0 | 1 | 2): StoredJudgment => ({
  qid,
  bookId,
  charStart: bookId * 1000,
  charEnd: bookId * 1000 + 500,
  indexVersion: 4,
  rubric: 1,
  textSha256: sha256(`text of book ${bookId}`),
  grade,
  judges: { A: grade, B: grade },
  adjudicated: false,
  run: "seed",
  date: "2026-11-16T10:00:00.000Z",
});
const STORE = ["q1", "q2", "q3", "q4"].flatMap((qid) => [judged(qid, 1, 2), judged(qid, 2, 1), judged(qid, 3, 0)]);
const A = runOf("A", [[3, 2, 1], [3, 2], [1, 2, 3], [1, 3], [3]]);
const B = runOf("B", [[1, 2, 3], [1, 3], [3, 1], [2, 3], [3]]);

// hand-derived per-query values: ideal [2, 1, 0] → IDCG = 3 + 1/log2(3)
const L3 = Math.log2(3);
const I = 3 + 1 / L3;
const ndcgA = [(1 / L3 + 3 / 2) / I, 1 / L3 / I, 1, 3 / I];
const ndcgB = [1, 3 / I, 3 / L3 / I, 1 / I];
const hitA = [1, 0, 1, 1];
const hitB = [1, 1, 1, 0];

const expectedRow = (group: string, idx: number[]): JudgedCompareRow => {
  const a = idx.map((i) => ndcgA[i]!);
  const b = idx.map((i) => ndcgB[i]!);
  const ha = idx.map((i) => hitA[i]!);
  const hb = idx.map((i) => hitB[i]!);
  const d = idx.map((i) => ndcgB[i]! - ndcgA[i]!);
  const wins = idx.filter((i) => hitA[i] === 0 && hitB[i] === 1).length;
  const losses = idx.filter((i) => hitA[i] === 1 && hitB[i] === 0).length;
  const p = pairedPermutationTest(d);
  const mde = minDetectableEffect(sampleSd(d), d.length);
  return {
    mode: "hybrid",
    group,
    n: idx.length,
    ndcgA: mean(a),
    ndcgACi: pairedBootstrapCI(a),
    ndcgB: mean(b),
    ndcgBCi: pairedBootstrapCI(b),
    hit5A: mean(ha),
    hit5ACi: pairedBootstrapCI(ha),
    hit5B: mean(hb),
    hit5BCi: pairedBootstrapCI(hb),
    delta: mean(d),
    ci: pairedBootstrapCI(d),
    p,
    hit5Wins: wins,
    hit5Losses: losses,
    signP: signTest(wins, losses),
    mde,
    underpowered: p >= 0.05 && Math.abs(mean(d)) < mde,
  };
};

describe("compareJudgedRuns — paired rows from the store", () => {
  it("agrees with the stats.ts primitives on hand-derived NDCG@5 and hit@5, overall then per category", () => {
    const rows = compareJudgedRuns(A, B, STORE);
    expect(rows).toEqual([
      expectedRow("overall", [0, 1, 2, 3]),
      expectedRow("concept", [2, 3]),
      expectedRow("para", [0, 1]),
    ]);
  });
  it("counts hit@5 flips: q2 is a win for B, q4 a loss", () => {
    const [overall] = compareJudgedRuns(A, B, STORE);
    expect([overall!.hit5Wins, overall!.hit5Losses]).toEqual([1, 1]);
    expect(overall!.ndcgA).toBeCloseTo(((1 / L3 + 3 / 2) / I + 1 / L3 / I + 1 + 3 / I) / 4, 12);
  });
  it("sampleSd is the n − 1 standard deviation", () => {
    expect(sampleSd([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(sampleSd([7])).toBe(0);
  });
});

describe("compareRefusal", () => {
  it("passes two runs of one query set with no holes in a compared top 5", () => {
    expect(compareRefusal(A, B, STORE, "/s/x.jsonl")).toBeUndefined();
  });
  it("refuses runs of different query sets", () => {
    const other = runOf(
      "B",
      [[1, 2, 3], [1, 3], [3, 1], [2, 3], [3]],
      [{ ...QUERIES[0]!, query: "Query q1" }, ...QUERIES.slice(1)],
    );
    const h = (r: CompareRun) => querySetHash(r.queriesJson).slice(0, 12);
    expect(compareRefusal(A, other, STORE, "/s/x.jsonl")).toBe(
      `refusing: query sets differ (A ${h(A)}, B ${h(other)}); compare runs of the same queries.json`,
    );
  });
  it("refuses an unjudged hit in a top 5 and names the dump command that fills it", () => {
    const holed = STORE.filter((r) => !(r.qid === "q2" && r.bookId === 2));
    expect(compareRefusal(A, B, holed, "/s/x.jsonl")).toBe(
      "refusing: run A has 1 unjudged hit(s) in a top 5 (first: q2 hybrid rank 2); fill the holes with " +
        "pnpm eval:judged:dump /runs/A --store /s/x.jsonl, judge the new batches, then pnpm eval:judged:score /runs/A --store /s/x.jsonl",
    );
  });
});

describe("renderJudgedCompare", () => {
  const header = {
    a: "A",
    b: "B",
    querySetSha256: "f".repeat(64),
    storeFile: "/s/x.jsonl",
    storeSha256: "e".repeat(64),
    records: 12,
  };
  it("prints the run names, the query-set and store hashes, and the same text every time", () => {
    const out = renderJudgedCompare(compareJudgedRuns(A, B, STORE), header);
    expect(renderJudgedCompare(compareJudgedRuns(A, B, STORE), header)).toBe(out);
    expect(out.split("\n").slice(0, 3)).toEqual([
      "compare B − A (paired by query id; Δ = NDCG@5 B − A, gain 2^grade − 1; flips = hit@5 wins/losses for B)",
      `query set sha256 ${"f".repeat(64)}`,
      `store /s/x.jsonl sha256 ${"e".repeat(64)} (12 records)`,
    ]);
    const rows = compareJudgedRuns(A, B, STORE);
    expect(out.split("\n").filter((l) => l.endsWith("UNDERPOWERED"))).toHaveLength(
      rows.filter((r) => r.underpowered).length,
    );
    expect(out.split("\n").filter((l) => l.startsWith("hybrid"))).toHaveLength(3);
  });
});

describe("pnpm eval:judged:compare (CLI)", () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/judged-compare.ts", ...args], {
      cwd: REPO,
      encoding: "utf8",
    });

  it("prints identical output on two invocations and refuses another query set", () => {
    const dir = mkdtempSync(join(tmpdir(), "judged-compare-"));
    try {
      const [a, b, c] = ["run-a", "run-b", "run-c"].map((n) => join(dir, n)) as [string, string, string];
      for (const d of [a, b, c]) cpSync(FIXTURE, d, { recursive: true });
      const queriesJson = readFileSync(join(a, "queries.json"), "utf8");
      const store = join(dir, storeFileName(queriesJson));
      importRun(a, store);
      const first = cli(a, b, "--store", store);
      const second = cli(a, b, "--store", store);
      expect([first.status, first.stderr]).toEqual([0, ""]);
      expect(second.stdout).toBe(first.stdout);
      expect(first.stdout.split("\n").slice(1, 3)).toEqual([
        `query set sha256 ${querySetHash(queriesJson)}`,
        `store ${store} sha256 ${sha256(readFileSync(store, "utf8"))} (18 records)`,
      ]);
      const qs = JSON.parse(queriesJson) as JudgedQuery[];
      writeFileSync(
        join(c, "queries.json"),
        JSON.stringify([{ ...qs[0]!, query: `${qs[0]!.query}!` }, ...qs.slice(1)]),
      );
      const refused = cli(a, c, "--store", store);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("refusing: query sets differ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
