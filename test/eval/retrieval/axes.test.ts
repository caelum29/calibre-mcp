// #363 report-only axes: the new per-row fields (durationMs, snippetHasMarker, top2Rerank,
// spanHit, lowConfidence) and the metrics built on them (snippet marker rate, span-hit@k,
// confidence false-flag rate + AUC, p50/p95 latency, the rerank on/off ablation matrix).
// None of them gates: thresholds.reportOnlyAxes declares each `gate: false`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Reranker } from "../../../src/semantic/reranker.js";
import { ablationMatrix, auc, computeAxes, percentile, renderAxes } from "./axes.js";
import type { Thresholds } from "./gate.js";
import { hashEmbedder } from "./hash-embedder.js";
import { runRetrievalEval, type EvalReport, type Mode, type PerQueryRow } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;

function report(rows: PerQueryRow[], modes: Mode[] = ["hybrid", "keyword"]): EvalReport {
  return {
    meta: { modes } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
  };
}

const pos = (id: string, scope: string, hit1: number, extra: Partial<PerQueryRow>): PerQueryRow => ({
  id,
  kind: "semantic-paraphrase",
  scope,
  mode: "hybrid",
  ru: false,
  retrieved: [],
  metrics: { hit1, recall5: hit1, rr: hit1, ndcg10: hit1 },
  ...extra,
});

// b1..b3 book scope, l1 library, n1 negative — all hybrid; k1 keyword (no rerank fields)
const ROWS: PerQueryRow[] = [
  pos("b1", "book", 1, {
    spanHit: 1,
    snippetHasMarker: true,
    maxRerank: 0.9,
    top2Rerank: 0.1,
    lowConfidence: false,
    durationMs: 10,
  }),
  pos("b2", "book", 0, {
    spanHit: 3,
    snippetHasMarker: false,
    maxRerank: 0.5,
    top2Rerank: 0.2,
    lowConfidence: false,
    durationMs: 20,
  }),
  pos("b3", "book", 0, { spanHit: null, maxRerank: 0.2, top2Rerank: 0.1, lowConfidence: true, durationMs: 30 }),
  pos("l1", "library", 1, { maxRerank: 0.5, top2Rerank: 0.25, lowConfidence: true, durationMs: 40 }),
  {
    id: "n1",
    kind: "negative",
    scope: "library",
    mode: "hybrid",
    ru: false,
    retrieved: [],
    flagged: true,
    maxRerank: 0.25,
    top2Rerank: 0,
    durationMs: 50,
  },
  { ...pos("k1", "library", 1, { lowConfidence: false }), mode: "keyword" },
];

describe("auc / percentile", () => {
  it("auc is the Mann-Whitney share of (pos, neg) pairs ranked right, ties half", () => {
    expect(auc([0.9, 0.5], [0.5, 0.2, 0.25])).toBe(5.5 / 6);
  });

  it("auc is NaN when a side is empty", () => {
    expect(auc([1], [])).toBeNaN();
  });

  it("percentile is nearest-rank", () => {
    expect([percentile([50, 10, 40, 20, 30], 0.5), percentile([50, 10, 40, 20, 30], 0.95)]).toEqual([30, 50]);
  });
});

describe("computeAxes", () => {
  const axes = computeAxes(report(ROWS));

  it("snippet marker: book-scope rows with a span hit, marker shown", () => {
    expect(axes.hybrid!.snippetMarker).toEqual({ shown: 1, n: 2 });
  });

  it("span-hit@k over positive book-scope rows (a null spanHit is a miss)", () => {
    expect(axes.hybrid!.spanHit).toEqual({ n: 3, at1: 1, at3: 2, at5: 2 });
  });

  it("confidence: false-flag rate on Hit@1 positives, AUC of maxRerank and of the top1-top2 margin", () => {
    const c = axes.hybrid!.confidence!;
    expect([c.n, c.hit1Positives, c.falseFlagged]).toEqual([5, 2, 1]);
    expect(c.aucMaxRerank).toBe(5.5 / 6);
    expect(c.aucMargin).toBe(4.5 / 6);
  });

  it("latency: nearest-rank p50/p95 of durationMs", () => {
    expect(axes.hybrid!.latency).toEqual({ n: 5, p50: 30, p95: 50 });
  });

  it("a mode with no reranked rows, book rows or timings has no such axis", () => {
    expect(axes.keyword).toEqual({ snippetMarker: { shown: 0, n: 0 }, spanHit: { n: 0, at1: 0, at3: 0, at5: 0 } });
  });
});

describe("renderAxes", () => {
  const lines = renderAxes(computeAxes(report(ROWS)), thresholds.reportOnlyAxes!);

  it("prints every declared axis with its trend, report-only", () => {
    expect(lines[0]).toBe("report-only axes (#363, thresholds.reportOnlyAxes; never gated)");
    for (const name of ["snippetMarker", "spanHit", "confidence", "latency", "ablation", "highlightInvariant"]) {
      expect(lines).toContain(`  ${name}: trend: ${thresholds.reportOnlyAxes![name]!.trend}`);
    }
  });

  it("prints the numbers per mode", () => {
    expect(lines).toEqual(
      expect.arrayContaining([
        "    hybrid: marker shown 1/2 (0.500)",
        "    hybrid: @1 1/3 (0.333), @3 2/3 (0.667), @5 2/3 (0.667)",
        "    hybrid: false-flag 1/2 (0.500), AUC maxRerank 0.917, AUC margin 0.750 (n=5)",
        "    hybrid: p50 30 ms, p95 50 ms (n=5)",
        "    keyword: n/a (no reranked rows)",
        "    not measured by this harness",
      ]),
    );
  });

  it("every axis is declared report-only", () => {
    expect(Object.values(thresholds.reportOnlyAxes!).every((a) => a.gate === false)).toBe(true);
  });
});

describe("ablationMatrix", () => {
  const agg = (hit1: number, ndcg10: number) => ({ n: 1, hit1, recall5: 1, mrr: 1, ndcg10 });
  const on = { ...report([]), overall: { hybrid: agg(0.9, 0.95), keyword: agg(0.7, 0.75) } };
  const off = { ...report([], ["hybrid"]), overall: { hybrid: agg(0.8, 0.85) } };

  it("modes x rerank on/off, overall Hit@1 / nDCG@10", () => {
    expect(ablationMatrix(on, off)).toEqual([
      "ablation (report-only): overall Hit@1 / nDCG@10, modes x rerank",
      "| mode | rerank on | rerank off |",
      "|---|---|---|",
      "| hybrid | 0.900 / 0.950 | 0.800 / 0.850 |",
      "| keyword | 0.700 / 0.750 | — |",
    ]);
  });
});

describe("harness row fields (hash embedder, fake reranker)", () => {
  // scores fall with fused position: first passage 1/2, second 1/3, …
  const fake: Reranker = {
    async rerank(_q, passages) {
      return passages.map((_, i) => 1 / (i + 2));
    },
    async warmup() {},
  };
  const base = { indexDir: ":memory:", embedder: hashEmbedder, gitSha: "test" };

  it("records durationMs only when timing is on", async () => {
    const plain = await runRetrievalEval({ ...base, modes: ["keyword"] });
    const timed = await runRetrievalEval({ ...base, modes: ["keyword"], timing: true });
    expect(plain.perQuery.some((r) => r.durationMs !== undefined)).toBe(false);
    expect(timed.perQuery.every((r) => Number.isInteger(r.durationMs) && r.durationMs! >= 0)).toBe(true);
  }, 30_000);

  it("adds spanHit / snippetHasMarker on book scope, top2Rerank on reranked rows, lowConfidence on positives", async () => {
    const r = await runRetrievalEval({ ...base, modes: ["hybrid"], reranker: fake });
    const book = r.perQuery.filter((x) => x.scope === "book" && x.metrics);
    expect(book.length).toBeGreaterThan(0);
    expect(book.every((x) => x.spanHit === null || (Number.isInteger(x.spanHit) && x.spanHit! >= 1))).toBe(true);
    expect(book.every((x) => (x.spanHit === null) === (x.snippetHasMarker === undefined))).toBe(true);
    expect(r.perQuery.filter((x) => x.scope !== "book").every((x) => x.spanHit === undefined)).toBe(true);
    const twoPlus = r.perQuery.filter((x) => x.reranked === true && x.retrieved.length >= 2);
    expect(twoPlus.length).toBeGreaterThan(0);
    expect(twoPlus.every((x) => x.top2Rerank === 0.3333)).toBe(true);
    expect(
      r.perQuery.filter((x) => x.metrics && x.retrieved.length > 0).every((x) => typeof x.lowConfidence === "boolean"),
    ).toBe(true);
  }, 30_000);
});
