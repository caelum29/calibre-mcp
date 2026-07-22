// Model-free smoke tests for the eval harness: end-to-end plumbing (build → query → score)
// with the hash embedder, plus the "broken ranking moves the metrics" proof from prompt 04.
// The REAL measurement runs via `pnpm eval` (run.ts) with the actual e5 model — not here.

import { describe, expect, it } from "vitest";
import type { Reranker } from "../../../src/semantic/reranker.js";
import type { IndexStore } from "../../../src/semantic/store.js";
import { hashEmbedder } from "./hash-embedder.js";
import { loadCorpus, loadQueries, runRetrievalEval } from "./harness.js";

const base = { indexDir: ":memory:", embedder: hashEmbedder } as const;

/** Wrap a store so every search comes back worst-first — a deliberately broken retriever. */
function reversed(inner: IndexStore): IndexStore {
  return {
    hasIndex: (l) => inner.hasIndex(l),
    hasVectors: (l) => inner.hasVectors(l),
    isBookIndexed: (l, b, m) => inner.isBookIndexed(l, b, m),
    replaceBook: (l, m, c, f) => inner.replaceBook(l, m, c, f),
    searchLibrary: (l, q, k) => inner.searchLibrary(l, q, k).reverse(),
    searchBook: (l, b, q, k) => inner.searchBook(l, b, q, k).reverse(),
    searchLibraryFts: (l, q, k) => inner.searchLibraryFts(l, q, k).reverse(),
    searchBookFts: (l, b, q, k) => inner.searchBookFts(l, b, q, k).reverse(),
    searchFigures: (l, q, k, b) => inner.searchFigures(l, q, k, b).reverse(),
    searchFiguresFts: (l, q, k, b) => inner.searchFiguresFts(l, q, k, b).reverse(),
    figureCount: (l, b) => inner.figureCount(l, b),
    chunkAt: (l, b, o) => inner.chunkAt(l, b, o),
    figuresInSpan: (l, b, s, e) => inner.figuresInSpan(l, b, s, e),
    stats: (l) => inner.stats(l),
    vectorCount: (l) => inner.vectorCount(l),
    close: () => inner.close(),
  };
}

describe("retrieval eval harness (model-free smoke)", () => {
  it("query set holds the prompt-04 contract: 40-70 queries, ~1/3 RU-involved, all kinds", () => {
    const { texts, markers } = loadCorpus();
    const queries = loadQueries(texts, markers); // also validates every span/figure label
    expect(queries.length).toBeGreaterThanOrEqual(40);
    expect(queries.length).toBeLessThanOrEqual(70);
    const ru = queries.filter((q) => q.ru === true).length;
    expect(ru / queries.length).toBeGreaterThanOrEqual(1 / 3);
    const kinds = new Set(queries.map((q) => q.kind));
    for (const k of [
      "semantic-paraphrase",
      "exact-identifier",
      "cross-lingual",
      "ru-monolingual",
      "negative",
      "figure-caption",
      "figure-negative",
    ]) {
      expect(kinds).toContain(k);
    }
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length); // ids unique
    // #85 gate contract: 6-8 gated figure-caption queries with 2 RU-monolingual inside;
    // cross-lingual caption queries are ungated diagnostics.
    const gatedFig = queries.filter((q) => q.kind === "figure-caption" && q.diagnostic !== true);
    expect(gatedFig.length).toBeGreaterThanOrEqual(6);
    expect(gatedFig.length).toBeLessThanOrEqual(8);
    expect(gatedFig.filter((q) => q.ru === true).length).toBeGreaterThanOrEqual(2);
    const figNegs = queries.filter((q) => q.kind === "figure-negative");
    expect(figNegs.length).toBeGreaterThanOrEqual(3);
    expect(figNegs.length).toBeLessThanOrEqual(4);
  });

  it("marker injection places every fixture inventory's figures (real path, page-1 fallback)", () => {
    const { corpus, texts, markers, inventories } = loadCorpus();
    const withFigures = corpus.books.filter((b) => b.figures !== undefined);
    expect(withFigures.length).toBeGreaterThan(0);
    // RU coverage per #85: inventories on 2 of the RU fixture books.
    expect(withFigures.filter((b) => b.language === "ru")).toHaveLength(2);
    for (const b of withFigures) {
      const ms = markers.get(b.bookId)!;
      expect(ms).toHaveLength(inventories.get(b.bookId)!.entries.length);
      // markers really are IN the indexed text, at their reported offsets
      for (const m of ms) {
        expect(texts.get(b.bookId)!.slice(m.charOffset, m.charOffset + 7)).toBe("[image ");
      }
    }
  });

  it("runs the full golden set end-to-end and produces a complete report", async () => {
    const report = await runRetrievalEval({ ...base, modes: ["keyword"] });
    expect(report.meta.queryCount).toBe(65);
    expect(report.meta.corpus.books).toBe(16);
    expect(report.overall.keyword?.n).toBe(56); // 65 minus 6 negatives minus 3 figure-negatives
    expect(report.negatives.keyword?.n).toBe(6);
    expect(report.figureNegatives.keyword?.n).toBe(3);
    expect(report.perQuery).toHaveLength(65);
    // figure-caption rows really ran through target=figures and retrieved figure keys
    const fig = report.perQuery.find((r) => r.id === "fig-01");
    expect(fig?.target).toBe("figures");
    expect(fig?.retrieved.every((k) => k.startsWith("fig-"))).toBe(true);
  }, 30_000);

  it("keyword mode nails exact-identifier queries on the fixture index", async () => {
    const report = await runRetrievalEval({ ...base, modes: ["keyword"] });
    expect(report.byKind["exact-identifier"]?.keyword?.hit1).toBeGreaterThanOrEqual(0.8);
  }, 30_000);

  it("a deliberately broken ranking moves the metrics down — the harness measures", async () => {
    const good = await runRetrievalEval({ ...base, modes: ["hybrid"] });
    const broken = await runRetrievalEval({
      ...base,
      modes: ["hybrid"],
      patchDeps: (deps) => ({ ...deps, index: reversed(deps.index) }),
    });
    expect(broken.overall.hybrid!.ndcg10).toBeLessThan(good.overall.hybrid!.ndcg10);
    expect(broken.overall.hybrid!.mrr).toBeLessThan(good.overall.hybrid!.mrr);
  }, 30_000);

  it("is deterministic: two identical runs produce identical reports", async () => {
    const a = await runRetrievalEval({ ...base, modes: ["hybrid"], gitSha: "test" });
    const b = await runRetrievalEval({ ...base, modes: ["hybrid"], gitSha: "test" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 30_000);

  it("measures the rerank stage: a hostile reranker marks rows and drags metrics down", async () => {
    // Scores rise with fused position → reverses every candidate pool (worst case rerank).
    const hostile: Reranker = {
      async rerank(_q, passages) {
        return passages.map((_, i) => i / Math.max(1, passages.length));
      },
      async warmup() {},
    };
    const off = await runRetrievalEval({ ...base, modes: ["hybrid"] });
    const on = await runRetrievalEval({ ...base, modes: ["hybrid"], reranker: hostile, rerank: "hostile-fake" });
    expect(off.meta.rerankedRows).toBe(0); // no reranker wired → nothing claimed
    expect(on.meta.rerankedRows).toBeGreaterThan(0);
    expect(on.perQuery.some((r) => r.reranked === true)).toBe(true);
    expect(on.overall.hybrid!.ndcg10).toBeLessThan(off.overall.hybrid!.ndcg10);
  }, 30_000);
});
