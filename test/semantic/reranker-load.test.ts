// Load-failure semantics at the reranker's optional-dep boundary (#45) — the same
// contract as the embedder's (see embedder-load.test.ts): missing dep is memoized as a
// stable RERANKER_UNAVAILABLE (Node 24 negatively caches the failed resolution, restart
// is the only remedy); transient failures are not memoized so a retry can succeed.

import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { TransformersReranker } from "../../src/semantic/reranker.js";

const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: "/tmp/unused-index" } as NodeJS.ProcessEnv);

/** ERR_MODULE_NOT_FOUND as Node raises it for a missing optional dep. */
function moduleNotFound(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(
    "Cannot find package '@huggingface/transformers'",
  );
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
