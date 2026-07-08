// Query/passage embedding over multilingual-e5-small via transformers.js (CPU, ONNX).
// The model is an OPTIONAL dependency: it's dynamically imported and lazily loaded on
// first use, so a read-only deployment that never embeds pays nothing and installs cleanly
// even when @huggingface/transformers is absent (→ coded EMBEDDER_UNAVAILABLE).
//
// e5's mandatory query:/passage: prefixes are prepended HERE so callers can't skip them;
// pooling=mean + normalize=true produce the L2-normalized vectors the index expects.

import path from "node:path";
import type { Config } from "../config.js";
import { EMBED_DIM, MODEL_ID, PASSAGE_PREFIX, QUERY_PREFIX } from "./model.js";

export interface Embedder {
  /** Embed a search string (prepends "query: "). */
  embedQuery(text: string): Promise<Float32Array>;
  /** Embed indexed passages (prepends "passage: "), batched. */
  embedPassages(texts: string[]): Promise<Float32Array[]>;
  /** Force the model to load (first-run download) — used to de-risk cold start. */
  warmup(): Promise<void>;
  /**
   * Token count of `text` under the MODEL's tokenizer (special tokens included, so it's
   * a slightly conservative window measure). Sync — requires the model to already be
   * loaded (`await warmup()` first); throws EMBEDDER_NOT_LOADED otherwise.
   */
  countTokens(text: string): number;
}

// Minimal structural view of the transformers.js feature-extraction pipeline — keeps the
// heavy optional dep's types out of the rest of the codebase (it's imported dynamically).
// The pipeline object carries its tokenizer; encode() → token ids incl. special tokens.
type FeaturePipeline = ((
  texts: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>) & {
  tokenizer: { encode(text: string): number[] };
};

/** Passages per model call — bounded so a large book doesn't build one giant batch. */
const BATCH = 10;

export class TransformersEmbedder implements Embedder {
  #pipe?: Promise<FeaturePipeline>;
  // Captured on load so countTokens can stay sync (chunking calls it in a tight loop).
  #tokenizer?: FeaturePipeline["tokenizer"];

  constructor(private readonly cfg: Config) {}

  async warmup(): Promise<void> {
    await this.#pipeline();
  }

  countTokens(text: string): number {
    if (!this.#tokenizer) {
      throw new Error("EMBEDDER_NOT_LOADED"); // await warmup() before counting tokens
    }
    return this.#tokenizer.encode(text).length;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [v] = await this.#embed([QUERY_PREFIX + text]);
    return v!;
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((t) => PASSAGE_PREFIX + t);
      out.push(...(await this.#embed(batch)));
    }
    return out;
  }

  async #embed(prefixed: string[]): Promise<Float32Array[]> {
    const pipe = await this.#pipeline();
    const tensor = await pipe(prefixed, { pooling: "mean", normalize: true });
    return tensor.tolist().map((row) => {
      if (row.length !== EMBED_DIM) {
        throw new Error(`embedding dim ${row.length} != expected ${EMBED_DIM}`);
      }
      return Float32Array.from(row);
    });
  }

  #pipeline(): Promise<FeaturePipeline> {
    if (!this.#pipe) this.#pipe = this.#load();
    return this.#pipe;
  }

  async #load(): Promise<FeaturePipeline> {
    let mod: typeof import("@huggingface/transformers");
    try {
      mod = await import("@huggingface/transformers");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
        throw new Error("EMBEDDER_UNAVAILABLE");
      }
      throw err;
    }
    // Cache the model under the index dir → downloads once, then runs offline.
    mod.env.cacheDir = path.join(this.cfg.indexDir, "models");
    mod.env.allowRemoteModels = true;
    const pipe = (await mod.pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
    })) as unknown as FeaturePipeline;
    this.#tokenizer = pipe.tokenizer;
    return pipe;
  }
}
