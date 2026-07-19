// Load-failure semantics at the optional-dep boundary (#45): a missing
// @huggingface/transformers is process-permanent on Node 24 (failed resolution is
// negatively cached — docs/node24-import-retry-probe.md), so the embedder must keep that
// failure memoized and stable; transient load failures must NOT be memoized so a retry
// can succeed. The module loader is injected — the one seam tests control.

import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { TransformersEmbedder } from "../../src/semantic/embedder.js";

const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: "/tmp/unused-index" } as NodeJS.ProcessEnv);

/** ERR_MODULE_NOT_FOUND as Node raises it for a missing optional dep. */
function moduleNotFound(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(
    "Cannot find package '@huggingface/transformers'",
  );
  err.code = "ERR_MODULE_NOT_FOUND";
  return err;
}

/** Minimal transformers.js stand-in for ACTIVE_MODEL's feature-extraction path. */
function fakeTransformersModule() {
  const pipe = Object.assign(async () => ({ tolist: () => [] }), {
    tokenizer: { encode: (text: string) => text.split(" ") },
  });
  return { env: {}, pipeline: async () => pipe } as unknown as
    typeof import("@huggingface/transformers");
}

describe("TransformersEmbedder load failures", () => {
  it("keeps a missing-dep failure memoized: stable EMBEDDER_UNAVAILABLE, no re-probe", async () => {
    // Loader would succeed on a second call (dep installed after startup) — but Node's
    // negative cache makes an in-process retry a lie, so the embedder must never re-probe.
    const loader = vi
      .fn<() => Promise<typeof import("@huggingface/transformers")>>()
      .mockRejectedValueOnce(moduleNotFound())
      .mockResolvedValue(fakeTransformersModule());
    const embedder = new TransformersEmbedder(cfg, loader);

    await expect(embedder.warmup()).rejects.toThrow("EMBEDDER_UNAVAILABLE");
    await expect(embedder.warmup()).rejects.toThrow("EMBEDDER_UNAVAILABLE");
    expect(loader).toHaveBeenCalledTimes(1);
    // loadState() surfaces the memoized-failed state for calibre_ping's diagnosis (#48).
    expect(embedder.loadState()).toBe("failed");
  });

  it("does not memoize a transient failure: a later call retries and succeeds", async () => {
    // e.g. the one-time model download failed on a flaky network — retry can genuinely work.
    const loader = vi
      .fn<() => Promise<typeof import("@huggingface/transformers")>>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue(fakeTransformersModule());
    const embedder = new TransformersEmbedder(cfg, loader);

    await expect(embedder.warmup()).rejects.toThrow("fetch failed");
    // A transient failure isn't a hard "failed" — it resets to not-attempted so a retry runs.
    expect(embedder.loadState()).toBe("not-attempted");
    await expect(embedder.warmup()).resolves.toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(embedder.loadState()).toBe("loaded");
  });
});
