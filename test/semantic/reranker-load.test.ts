// Load-failure semantics at the reranker's optional-dep boundary (#45) — the same
// contract as the embedder's (see embedder-load.test.ts): missing dep is memoized as a
// stable RERANKER_UNAVAILABLE (Node 24 negatively caches the failed resolution, restart
// is the only remedy); transient failures are not memoized so a retry can succeed.

import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { RERANK_MAX_WAITING, TransformersReranker } from "../../src/semantic/reranker.js";

const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: "/tmp/unused-index" } as NodeJS.ProcessEnv);

/** ERR_MODULE_NOT_FOUND as Node raises it for a missing optional dep. */
function moduleNotFound(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error("Cannot find package '@huggingface/transformers'");
  err.code = "ERR_MODULE_NOT_FOUND";
  return err;
}

/** Minimal transformers.js stand-in for the sequence-classification path. */
function fakeTransformersModule() {
  return {
    env: {},
    AutoTokenizer: { from_pretrained: async () => () => ({}) },
    AutoModelForSequenceClassification: { from_pretrained: async () => async () => ({}) },
  } as unknown as typeof import("@huggingface/transformers");
}

describe("TransformersReranker load failures", () => {
  it("keeps a missing-dep failure memoized: stable RERANKER_UNAVAILABLE, no re-probe", async () => {
    const loader = vi
      .fn<() => Promise<typeof import("@huggingface/transformers")>>()
      .mockRejectedValueOnce(moduleNotFound())
      .mockResolvedValue(fakeTransformersModule());
    const reranker = new TransformersReranker(cfg, loader);

    await expect(reranker.warmup()).rejects.toThrow("RERANKER_UNAVAILABLE");
    await expect(reranker.warmup()).rejects.toThrow("RERANKER_UNAVAILABLE");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not memoize a transient failure: a later call retries and succeeds", async () => {
    const loader = vi
      .fn<() => Promise<typeof import("@huggingface/transformers")>>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue(fakeTransformersModule());
    const reranker = new TransformersReranker(cfg, loader);

    await expect(reranker.warmup()).rejects.toThrow("fetch failed");
    await expect(reranker.warmup()).resolves.toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("TransformersReranker concurrency (#156)", () => {
  /** Fake module whose forward pass takes `ms` and logs which query it scored. */
  function slowModule(ms: number, log: string[]) {
    return {
      env: {},
      AutoTokenizer: { from_pretrained: async () => (texts: string[]) => ({ q: texts[0] }) },
      AutoModelForSequenceClassification: {
        from_pretrained: async () => async (inputs: { q: string }) => {
          await new Promise((r) => setTimeout(r, ms));
          log.push(inputs.q);
          return { logits: { sigmoid: () => ({ tolist: () => [[0.5]] }) } };
        },
      },
    } as unknown as typeof import("@huggingface/transformers");
  }

  it("scores concurrent calls one whole call at a time, in arrival order", async () => {
    const log: string[] = [];
    const reranker = new TransformersReranker(cfg, async () => slowModule(2, log));
    await reranker.warmup();
    await Promise.all([
      reranker.rerank("a", ["p1", "p2"]),
      reranker.rerank("b", ["p1", "p2"]),
      reranker.rerank("c", ["p1"]),
    ]);
    // No interleaving: every pair of call "a" before any of "b", etc.
    expect(log).toEqual(["a", "a", "b", "b", "c"]);
  });

  it("refuses with RERANKER_BUSY once RERANK_MAX_WAITING calls are queued", async () => {
    const reranker = new TransformersReranker(cfg, async () => slowModule(5, []));
    await reranker.warmup();
    const admitted = Array.from({ length: RERANK_MAX_WAITING + 1 }, () => reranker.rerank("q", ["p"]));
    await expect(reranker.rerank("late", ["p"])).rejects.toThrow("RERANKER_BUSY");
    await expect(Promise.all(admitted)).resolves.toHaveLength(RERANK_MAX_WAITING + 1);
  });
});
