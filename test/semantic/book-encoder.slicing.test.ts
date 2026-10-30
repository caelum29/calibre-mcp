// Embed slicing for sub-book progress (#245) must not change a single vector: the slices are
// whole multiples of the embedder's batch, so the model sees exactly the batches it saw before.
// The fake embedder here is batch-sensitive, like a real padded forward pass can be.

import { describe, expect, it } from "vitest";
import { inThreadEncoder, type EncodeJob } from "../../src/semantic/book-encoder.js";
import { PASSAGE_BATCH, type Embedder } from "../../src/semantic/embedder.js";

/** Vector = (size of the internal batch, the passage's position in it, its batch's first text length). */
function batchSensitiveEmbedder(): Embedder & { batches: number[] } {
  const batches: number[] = [];
  return {
    batches,
    async embedQuery() {
      return new Float32Array(3);
    },
    async embedPassages(texts) {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += PASSAGE_BATCH) {
        const batch = texts.slice(i, i + PASSAGE_BATCH);
        batches.push(batch.length);
        batch.forEach((_, j) => out.push(Float32Array.of(batch.length, j, batch[0]!.length)));
      }
      return out;
    },
    async warmup() {},
    countTokens: (s) => s.length,
  };
}

const job: EncodeJob = {
  // Varied sentence lengths, so chunk bodies (and each batch's first text) differ.
  text: Array.from({ length: 2500 }, (_, i) => `Sentence ${i} ${"word ".repeat(i % 13)}ends here.`).join(" "),
  ctx: "[Big Book › Someone]\n",
  outline: [],
  captions: [],
  keywordOnly: false,
  tokenBudgeted: false,
};

describe("inThreadEncoder embed slicing (#245)", () => {
  it("produces the same vectors and model batches with or without progress hooks", async () => {
    const plain = batchSensitiveEmbedder();
    const sliced = batchSensitiveEmbedder();
    const reported: number[] = [];

    const a = await inThreadEncoder(plain).encode(job);
    const b = await inThreadEncoder(sliced).encode(job, { onEmbedProgress: (done) => reported.push(done) });

    // Big enough to need several slices, and not a whole number of them.
    expect(a.chunks.length).toBeGreaterThan(120);
    expect(a.chunks.length % PASSAGE_BATCH).not.toBe(0);
    expect(reported.length).toBeGreaterThanOrEqual(2);
    expect(sliced.batches).toEqual(plain.batches);
    expect(b.vectors).toEqual(a.vectors);
  });
});
