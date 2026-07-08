// Query/passage embedding over the ACTIVE_MODEL spec via transformers.js (CPU, ONNX).
// The model is an OPTIONAL dependency: it's dynamically imported and lazily loaded on
// first use, so a read-only deployment that never embeds pays nothing and installs cleanly
// even when @huggingface/transformers is absent (→ coded EMBEDDER_UNAVAILABLE).
//
// The model card's mandatory prefixes are prepended HERE so callers can't skip them; the
// per-model output scheme (pipeline pooling vs a baked-in `sentence_embedding` graph, MRL
// truncation) lives in ACTIVE_MODEL — see model.ts for the cited candidate table.

import path from "node:path";
import type { Config } from "../config.js";
import { ACTIVE_MODEL, type EmbeddingModelSpec } from "./model.js";
import { l2normalize } from "./vector.js";

export interface Embedder {
  /** Embed a search string (prepends the model's query prefix). */
  embedQuery(text: string): Promise<Float32Array>;
  /** Embed indexed passages (prepends the model's passage prefix), batched. */
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

/**
 * Shape one raw model row into the stored vector: dim-check, MRL-truncate when the spec
 * says so (slice to `dim`, then re-normalize — the model card's recipe), L2-normalize
 * always (idempotent for already-normalized output; the index requires unit vectors).
 */
export function toStoredVector(
  row: number[],
  spec: Pick<EmbeddingModelSpec, "dim" | "rawDim"> = ACTIVE_MODEL,
): Float32Array {
  const expected = spec.rawDim ?? spec.dim;
  if (row.length !== expected) {
    throw new Error(`embedding dim ${row.length} != expected ${expected}`);
  }
  const v = Float32Array.from(spec.rawDim ? row.slice(0, spec.dim) : row);
  return l2normalize(v);
}

// Minimal structural views of the transformers.js pieces we touch — keeps the heavy
// optional dep's types out of the rest of the codebase (it's imported dynamically).
type Tokenizer = { encode(text: string): number[] };
// feature-extraction pipeline: model emits token states, pooling/normalize happen JS-side.
type FeaturePipeline = ((
  texts: string[],
  opts: { pooling: "mean" | "cls"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>) & { tokenizer: Tokenizer };
// baked-in path (EmbeddingGemma): callable tokenizer → model → `sentence_embedding`.
type BatchTokenizer = ((
  texts: string[],
  opts: { padding: boolean; truncation: boolean },
) => Record<string, unknown>) &
  Tokenizer;
type SentenceEmbeddingModel = (inputs: Record<string, unknown>) => Promise<{
  sentence_embedding: { tolist(): number[][] };
}>;

/** One loaded model, normalized to "texts in → raw rows out" whatever the output scheme. */
interface Loaded {
  embed(texts: string[]): Promise<number[][]>;
  tokenizer: Tokenizer;
}

/** Passages per model call — bounded so a large book doesn't build one giant batch. */
const BATCH = 10;

export class TransformersEmbedder implements Embedder {
  #loaded?: Promise<Loaded>;
  // Captured on load so countTokens can stay sync (chunking calls it in a tight loop).
  #tokenizer?: Tokenizer;

  constructor(private readonly cfg: Config) {}

  async warmup(): Promise<void> {
    await this.#model();
  }

  countTokens(text: string): number {
    if (!this.#tokenizer) {
      throw new Error("EMBEDDER_NOT_LOADED"); // await warmup() before counting tokens
    }
    return this.#tokenizer.encode(text).length;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [v] = await this.#embed([ACTIVE_MODEL.queryPrefix + text]);
    return v!;
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((t) => ACTIVE_MODEL.passagePrefix + t);
      out.push(...(await this.#embed(batch)));
    }
    return out;
  }

  async #embed(prefixed: string[]): Promise<Float32Array[]> {
    const { embed } = await this.#model();
    const rows = await embed(prefixed);
    return rows.map((row) => toStoredVector(row));
  }

  #model(): Promise<Loaded> {
    if (!this.#loaded) this.#loaded = this.#load();
    return this.#loaded;
  }

  async #load(): Promise<Loaded> {
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

    const { id, dtype, pooling } = ACTIVE_MODEL;
    let loaded: Loaded;
    if (pooling === "baked-in") {
      // Graph emits `sentence_embedding` (card usage: AutoTokenizer + AutoModel) —
      // running this through the feature-extraction pipeline would re-pool token states
      // and silently skip the model's own projection layers.
      const tokenizer = (await mod.AutoTokenizer.from_pretrained(id)) as unknown as BatchTokenizer;
      const model = (await mod.AutoModel.from_pretrained(id, {
        dtype,
      })) as unknown as SentenceEmbeddingModel;
      loaded = {
        embed: async (texts) => {
          const inputs = tokenizer(texts, { padding: true, truncation: true });
          return (await model(inputs)).sentence_embedding.tolist();
        },
        tokenizer,
      };
    } else {
      const pipe = (await mod.pipeline("feature-extraction", id, {
        dtype,
      })) as unknown as FeaturePipeline;
      loaded = {
        embed: async (texts) => (await pipe(texts, { pooling, normalize: true })).tolist(),
        tokenizer: pipe.tokenizer,
      };
    }
    this.#tokenizer = loaded.tokenizer;
    return loaded;
  }
}
