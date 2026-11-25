// Pair truncation seam (#644): TransformersReranker truncates each (query, passage) pair to the
// call's maxTokens when given (the 256-token A/B arm), to the shipped 512 otherwise, and keeps
// scoring one pair per forward pass.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { TransformersReranker } from "../../src/semantic/reranker.js";

const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: "/tmp/unused-index" });

/** Fake transformers.js module whose tokenizer records the max_length and pair count of every call. */
function recordingModule(seen: { maxLength: number; pairs: number }[]) {
  return {
    env: {},
    AutoTokenizer: {
      from_pretrained: async () => (texts: string[], opts: { text_pair: string[]; max_length: number }) => {
        seen.push({ maxLength: opts.max_length, pairs: Math.max(texts.length, opts.text_pair.length) });
        return {};
      },
    },
    AutoModelForSequenceClassification: {
      from_pretrained: async () => async () => ({ logits: { sigmoid: () => ({ tolist: () => [[0.5]] }) } }),
    },
  } as unknown as typeof import("@huggingface/transformers");
}

describe("TransformersReranker maxTokens (#644)", () => {
  it("truncates pairs to 512 tokens when no maxTokens is given", async () => {
    const seen: { maxLength: number; pairs: number }[] = [];
    const reranker = new TransformersReranker(cfg, async () => recordingModule(seen));
    await reranker.rerank("q", ["p1", "p2"]);
    expect(seen).toEqual([
      { maxLength: 512, pairs: 1 },
      { maxLength: 512, pairs: 1 },
    ]);
  });

  it("truncates every pair to the call's maxTokens, still one pair per forward", async () => {
    const seen: { maxLength: number; pairs: number }[] = [];
    const reranker = new TransformersReranker(cfg, async () => recordingModule(seen));
    await reranker.rerank("q", ["p1", "p2"], { maxTokens: 256 });
    expect(seen).toEqual([
      { maxLength: 256, pairs: 1 },
      { maxLength: 256, pairs: 1 },
    ]);
  });
});
