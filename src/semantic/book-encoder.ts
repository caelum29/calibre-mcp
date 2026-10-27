// The CPU-bound half of indexing one book: token-budgeted chunking, front-matter detection
// and passage/caption embedding. Behind an interface so it can run on the calling thread
// (the tool) or in a worker thread (bulk re-index, #99) — chunking + tokenizing are sync JS,
// so book-level concurrency on ONE thread can't speed them up.

import { frontMatterEnd } from "../domain/structure/front-matter.js";
import type { OutlineEntry } from "../domain/structure/pdf-outline.js";
import { chunkForEmbeddingAsync, type EmbedChunk } from "./chunk.js";
import type { Embedder } from "./embedder.js";
import { MAX_TOKENS, PASSAGE_PREFIX } from "./model.js";

/** Floor on the token budget — a pathologically long title/authors prefix can't starve chunks. */
const MIN_TOKEN_BUDGET = 64;

export interface EncodeJob {
  /** Extracted (marker-injected) book text. */
  text: string;
  /** "[title › authors]\n" context prefix — embedded, never stored. */
  ctx: string;
  /** PDF outline (bookmarks) — preferred chapter-map source for the front-matter boundary (#134). */
  outline: OutlineEntry[];
  /** Figure captions to embed alongside the passages (empty when none were placed). */
  captions: string[];
  keywordOnly: boolean;
  /** True only after a successful embedder warmup — token budgeting needs a loaded tokenizer. */
  tokenBudgeted: boolean;
}

export interface EncodeResult {
  chunks: EmbedChunk[];
  /** End of front matter in `text` (0 = none detected). */
  fmEnd: number;
  /** One per chunk; absent on keyword-only builds. */
  vectors?: Float32Array[];
  /** One per caption; absent on keyword-only builds. */
  captionVectors?: Float32Array[];
  phaseMs: { chunk: number; embed: number };
}

export interface BookEncoder {
  encode(job: EncodeJob): Promise<EncodeResult>;
}

/** Encoder that runs on the calling thread with the given embedder. */
export function inThreadEncoder(embedder: Embedder): BookEncoder {
  return {
    async encode(job) {
      const t0 = Date.now();
      let chunks: EmbedChunk[];
      if (!job.keywordOnly && job.tokenBudgeted) {
        // Budget in REAL model tokens: the e5 window minus what the "passage: " + context
        // prefixes consume, so RU chunks stop being over-conservative and EN chunks stop
        // silently wasting window. countTokens is safe here — warmup succeeded (tokenBudgeted).
        const budget = Math.max(MIN_TOKEN_BUDGET, MAX_TOKENS - embedder.countTokens(PASSAGE_PREFIX + job.ctx));
        // Async: yields between chunks so a big book can't freeze concurrent I/O (#99).
        chunks = await chunkForEmbeddingAsync(job.text, { budget, lengthFn: (s) => embedder.countTokens(s) });
      } else {
        // No loaded model (keyword-only or a failed warmup) — no token window to respect;
        // the conservative char-based default applies.
        chunks = await chunkForEmbeddingAsync(job.text);
      }
      const fmEnd = chunks.length > 0 ? frontMatterEnd(job.text, { outline: job.outline }) : 0;
      const t1 = Date.now();
      if (job.keywordOnly || chunks.length === 0) {
        return { chunks, fmEnd, phaseMs: { chunk: t1 - t0, embed: 0 } };
      }
      const vectors = await embedder.embedPassages(chunks.map((c) => job.ctx + c.body));
      const captionVectors =
        job.captions.length > 0 ? await embedder.embedPassages(job.captions.map((c) => job.ctx + c)) : [];
      return { chunks, fmEnd, vectors, captionVectors, phaseMs: { chunk: t1 - t0, embed: Date.now() - t1 } };
    },
  };
}
