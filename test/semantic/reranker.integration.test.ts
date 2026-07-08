// Live transformers.js de-risk for the cross-encoder — GATED behind RUN_MODEL_TESTS so CI
// stays offline/fast. Run on the real machine with:
//   RUN_MODEL_TESTS=1 pnpm vitest run test/semantic/reranker.integration.test.ts
// First run downloads the ~576 MB q8 bge-reranker-v2-m3 model; later runs are offline.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { TransformersReranker } from "../../src/semantic/reranker.js";

const RUN = process.env.RUN_MODEL_TESTS === "1";

describe.skipIf(!RUN)("TransformersReranker (live model)", () => {
  const reranker = new TransformersReranker(loadConfig());

  it("returns one sigmoid score per pair, relevant above irrelevant", async () => {
    const t0 = performance.now();
    const scores = await reranker.rerank("how does rust ownership work", [
      "Ownership is Rust's memory model: each value has a single owner and borrowing rules.",
      "A recipe for chocolate chip cookies with brown butter.",
    ]);
    // eslint-disable-next-line no-console
    console.error(`[reranker] cold-start rerank took ${Math.round(performance.now() - t0)}ms`);
    expect(scores).toHaveLength(2);
    for (const s of scores) expect(s).toBeGreaterThanOrEqual(0);
    for (const s of scores) expect(s).toBeLessThanOrEqual(1);
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
  }, 600_000);

  it("scores cross-lingually (RU passage answers an EN query)", async () => {
    const scores = await reranker.rerank("message delivery guarantees in kafka", [
      "Kafka гарантирует доставку сообщений: at-least-once, at-most-once и exactly-once семантики.",
      "Сборник рецептов украинского борща и вареников.",
    ]);
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
  }, 120_000);
});
