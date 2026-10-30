// Cross-encoder rerank stage over (query, passage) pairs — the precision lever on top of
// RRF fusion (D-011). Mirrors the embedder's optional-model pattern: @huggingface/transformers
// is dynamically imported and lazily loaded on first use, so installs without it stay clean
// and callers degrade on the coded RERANKER_UNAVAILABLE instead of failing the search.

import path from "node:path";
import type { Config } from "../config.js";
import type { TransformersLoader } from "./embedder.js";
import { InferenceQueue, QUEUE_BUSY } from "./queue.js";

// Single source of truth for the reranker model (same D-001 principle as model.ts, kept
// local because model.ts documents the EMBEDDING model contract). bge-reranker-v2-m3:
// 568M params (q8 ONNX ≈ 576 MB one-time download — pre-warmed by calibre_build_index),
// multilingual (EN+RU), ~52 BEIR nDCG@10; runs on CPU via transformers.js.
export const RERANKER_MODEL_ID = "onnx-community/bge-reranker-v2-m3-ONNX";
/**
 * @public — documentation constant, intentionally unreferenced.
 * Repo revision this build was verified against (2025-09-01) — documentation, NOT passed to
 * from_pretrained: transformers.js 4.2.0's tokenizer-file existence probe drops the revision
 * (and cache_dir) options, so a revision-pinned cache misses and every offline load fails.
 */
export const RERANKER_REVISION = "6f5ff65298512715a1e669753bc754d2bc8f367b";

/**
 * Hard cap on cross-encoded pairs — the latency guard. Measured on Apple Silicon CPU (q8,
 * 512-token pairs): ~0.35–0.5 s/pair warm ⇒ ~10–15 s per full 30-pool. Fused candidates past
 * the cap are appended after the reranked head in fused order (they carry no rerank score).
 */
export const RERANK_POOL = 30;
/**
 * Sigmoid scores below this are weak matches — the reranker's own confidence signal. Re-checked
 * 2026-10-23 (D-022): on the real library 0.3 flags ~3% of correct answers and every negative;
 * lower floors only look better on the short synthetic fixture and leak real negatives.
 */
export const RERANK_FLOOR = 0.3;
/**
 * Rerank calls allowed to WAIT behind the running one (#156). A full pool costs ~10–15 s, so
 * running + 2 waiting ≈ 45 s worst case — inside the 60 s default MCP request timeout. A call
 * past the cap gets RERANKER_BUSY and the search keeps its fused order instead of timing out.
 */
export const RERANK_MAX_WAITING = 2;
/** Pair truncation length. Chunks are budgeted to the e5 window, so nothing real is lost. */
const MAX_TOKENS = 512;

export interface Reranker {
  /**
   * Score each (query, passage) pair with the cross-encoder; returns one sigmoid-normalized
   * relevance score in [0,1] per passage, in input order. Throws RERANKER_UNAVAILABLE when
   * the optional model dependency is missing, and RERANKER_BUSY when too many rerank calls
   * are already queued (the caller degrades to its fused order).
   */
  rerank(query: string, passages: string[]): Promise<number[]>;
  /**
   * Force the model to load — calibre_build_index pre-warms best-effort so the one-time
   * ~576 MB download lands inside the build (already slow), not on the first search.
   */
  warmup(): Promise<void>;
}

// Minimal structural view of the transformers.js pieces we touch — keeps the heavy optional
// dep's types out of the rest of the codebase (same trick as the embedder's FeaturePipeline).
type PairTokenizer = (
  texts: string[],
  opts: { text_pair: string[]; padding: boolean; truncation: boolean; max_length: number },
) => Record<string, unknown>;
type SeqClassifier = (inputs: Record<string, unknown>) => Promise<{
  logits: { sigmoid(): { tolist(): number[][] } };
}>;

/** Cross-encoder reranker backed by transformers.js; lazily loads the optional model on first use. */
export class TransformersReranker implements Reranker {
  #loaded?: Promise<{ tokenizer: PairTokenizer; model: SeqClassifier }>;
  // One rerank call at a time, FIFO: concurrent calls would interleave forwards and all finish late.
  readonly #queue = new InferenceQueue(RERANK_MAX_WAITING);

  constructor(
    private readonly cfg: Config,
    private readonly loadTransformers: TransformersLoader = () => import("@huggingface/transformers"),
  ) {}

  async warmup(): Promise<void> {
    await this.#components();
  }

  async rerank(query: string, passages: string[]): Promise<number[]> {
    if (passages.length === 0) return [];
    const { tokenizer, model } = await this.#components();
    try {
      // The whole call is one queue task, so a request's pairs never interleave with another's.
      return await this.#queue.run(() => this.#score(tokenizer, model, query, passages));
    } catch (err) {
      if (err instanceof Error && err.message === QUEUE_BUSY) throw new Error("RERANKER_BUSY");
      throw err;
    }
  }

  async #score(tokenizer: PairTokenizer, model: SeqClassifier, query: string, passages: string[]): Promise<number[]> {
    const scores: number[] = [];
    // Solo scoring (D-011 amendment, #98): one pair per forward. Batched padding made a
    // pair's q8 logit depend on which passages shared its batch (0.1–0.6 logit shifts →
    // pool-composition-dependent order); solo keeps the score a pure function of the pair
    // for ~+6% latency on a full 30-pool (CPU batching buys almost nothing here).
    for (const passage of passages) {
      const inputs = tokenizer([query], {
        text_pair: [passage],
        padding: true,
        truncation: true,
        max_length: MAX_TOKENS,
      });
      const { logits } = await model(inputs);
      // [1, 1] logits → sigmoid → one score for the pair.
      scores.push(logits.sigmoid().tolist()[0]?.[0] ?? 0);
    }
    return scores;
  }

  #components(): Promise<{ tokenizer: PairTokenizer; model: SeqClassifier }> {
    if (!this.#loaded) {
      // Same failure contract as the embedder's #model(): a missing dep stays memoized
      // (Node 24 negatively caches the failed resolution — restart is the only remedy;
      // docs/dev/node24-import-retry-probe.md), anything else may be transient → retry.
      this.#loaded = this.#load().catch((err: unknown) => {
        if (!(err instanceof Error && err.message === "RERANKER_UNAVAILABLE")) {
          this.#loaded = undefined;
        }
        throw err;
      });
    }
    return this.#loaded;
  }

  async #load(): Promise<{ tokenizer: PairTokenizer; model: SeqClassifier }> {
    let mod: typeof import("@huggingface/transformers");
    try {
      mod = await this.loadTransformers();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
        throw new Error("RERANKER_UNAVAILABLE");
      }
      throw err;
    }
    // Same cache dir as the embedder → both models live under <indexDir>/models.
    mod.env.cacheDir = path.join(this.cfg.indexDir, "models");
    mod.env.allowRemoteModels = true;
    // No revision option (see RERANKER_REVISION docs) — default "main", like the embedder.
    const tokenizer = (await mod.AutoTokenizer.from_pretrained(RERANKER_MODEL_ID)) as unknown as PairTokenizer;
    const model = (await mod.AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL_ID, {
      dtype: "q8",
    })) as unknown as SeqClassifier;
    return { tokenizer, model };
  }
}
