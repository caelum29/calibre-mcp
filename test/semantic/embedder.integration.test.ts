// Live transformers.js de-risk — GATED behind RUN_MODEL_TESTS so CI stays offline/fast.
// Run on the real machine with:  RUN_MODEL_TESTS=1 pnpm vitest run test/semantic/embedder.integration.test.ts
// First run downloads the ~118 MB q8 model (huggingface.co); later runs are offline.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { TransformersEmbedder } from "../../src/semantic/embedder.js";
import { dot } from "../../src/semantic/vector.js";

const RUN = process.env.RUN_MODEL_TESTS === "1";

describe.skipIf(!RUN)("TransformersEmbedder (live model)", () => {
  const embedder = new TransformersEmbedder(loadConfig());

  it("cold-starts and returns a unit-norm 384-dim vector", async () => {
    const t0 = performance.now();
    const v = await embedder.embedQuery("hello world");
    // eslint-disable-next-line no-console
    console.error(`[embedder] cold-start embed took ${Math.round(performance.now() - t0)}ms`);
    expect(v.length).toBe(EMBED_DIM);
    expect(dot(v, v)).toBeCloseTo(1, 3); // normalize=true → ~unit norm
  }, 120_000);

  it("ranks a relevant EN passage above an unrelated one", async () => {
    const q = await embedder.embedQuery("cat");
    const [relevant, unrelated] = await embedder.embedPassages([
      "a small domestic feline that purrs",
      "quantum chromodynamics and the strong nuclear force",
    ]);
    expect(dot(q, relevant!)).toBeGreaterThan(dot(q, unrelated!));
  }, 120_000);

  it("works cross-lingually (RU query finds RU passage over unrelated EN)", async () => {
    const q = await embedder.embedQuery("книга о программировании");
    const [ru, en] = await embedder.embedPassages([
      "учебник по языку программирования и алгоритмам",
      "a recipe for chocolate chip cookies",
    ]);
    expect(dot(q, ru!)).toBeGreaterThan(dot(q, en!));
  }, 120_000);
});
