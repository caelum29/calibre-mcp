// The CPU-bound half of indexing one book: token-budgeted chunking, front-matter detection
// and passage/caption embedding. Behind an interface so it can run on the calling thread
// (the tool) or in a worker thread (bulk re-index, #99) — chunking + tokenizing are sync JS,
// so book-level concurrency on ONE thread can't speed them up.

import { frontMatterEnd } from "../domain/structure/front-matter.js";
import { bookSections, sectionPathAt, sectionPrefix, sectionStarts } from "../domain/structure/sections.js";
import type { EpubToc } from "../domain/structure/epub-toc.js";
import type { OutlineEntry } from "../domain/structure/pdf-outline.js";
import { chunkForEmbeddingAsync, type EmbedChunk } from "./chunk.js";
import { PASSAGE_BATCH, type Embedder } from "./embedder.js";
import { MAX_TOKENS, PASSAGE_PREFIX } from "./model.js";
import { l2normalize } from "./vector.js";

/** Floor on the token budget — a pathologically long title/authors prefix can't starve chunks. */
const MIN_TOKEN_BUDGET = 64;
/**
 * Passages per embedPassages call when progress is reported (#245). A whole multiple of the
 * embedder's own batch, so the model sees exactly the same batches — vectors are unchanged.
 */
const EMBED_SLICE = PASSAGE_BATCH * 5;

export interface EncodeJob {
  /** Extracted (marker-injected) book text. */
  text: string;
  /** "[title › authors]\n" context prefix — embedded, never stored. */
  ctx: string;
  /** #620 spike: book title for the section-path prefix, and the extracted format (EPUB = Markdown). */
  title?: string;
  format?: string;
  /** PDF outline (bookmarks) — preferred chapter-map source for the front-matter boundary (#134). */
  outline: OutlineEntry[];
  /** EPUB authored TOC (#269) — plain data, so it survives the worker-thread postMessage. */
  epubToc?: EpubToc;
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
  /** #620 spike: summed prefix tokens over the chunks (mean = sum / chunks), arms 1–3 only. */
  prefixTokens?: number;
}

/** Optional in-process callbacks for one encode — never sent to a worker thread. */
export interface EncodeHooks {
  /** Called after each embedded slice but the last: `done` of `total` chunks have vectors. */
  onEmbedProgress?: (done: number, total: number) => void;
}

export interface BookEncoder {
  encode(job: EncodeJob, hooks?: EncodeHooks): Promise<EncodeResult>;
}

/** Encoder that runs on the calling thread with the given embedder. */
export function inThreadEncoder(embedder: Embedder): BookEncoder {
  return {
    async encode(job, hooks) {
      const arm = spikeArm();
      if (arm > 0 && !job.keywordOnly && job.tokenBudgeted && job.title !== undefined) {
        return encodeSpikeArm(embedder, job, arm, hooks);
      }
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
      const fmEnd = chunks.length > 0 ? frontMatterEnd(job.text, structureOf(job)) : 0;
      const t1 = Date.now();
      // #620 spike: arm 0's prefix cost, comparable to the arms' per-chunk sums.
      const prefixTokens =
        !job.keywordOnly && job.tokenBudgeted
          ? chunks.length * embedder.countTokens(PASSAGE_PREFIX + job.ctx)
          : undefined;
      if (job.keywordOnly || chunks.length === 0) {
        return { chunks, fmEnd, phaseMs: { chunk: t1 - t0, embed: 0 } };
      }
      const vectors = await embedSliced(
        embedder,
        chunks.map((c) => job.ctx + c.body),
        hooks?.onEmbedProgress,
      );
      const captionVectors =
        job.captions.length > 0 ? await embedder.embedPassages(job.captions.map((c) => job.ctx + c)) : [];
      return {
        chunks,
        fmEnd,
        vectors,
        captionVectors,
        phaseMs: { chunk: t1 - t0, embed: Date.now() - t1 },
        ...(prefixTokens !== undefined ? { prefixTokens } : {}),
      };
    },
  };
}

/**
 * Embed passages slice by slice so a big book can report progress mid-embed (#245) — one
 * book of ~900 chunks otherwise runs minutes with no sign of life and the client times out.
 */
async function embedSliced(
  embedder: Embedder,
  texts: string[],
  onProgress: ((done: number, total: number) => void) | undefined,
): Promise<Float32Array[]> {
  if (!onProgress) return embedder.embedPassages(texts);
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_SLICE) {
    out.push(...(await embedder.embedPassages(texts.slice(i, i + EMBED_SLICE))));
    // The final slice is the book's end — the caller's per-book step reports that.
    if (out.length < texts.length) onProgress(out.length, texts.length);
  }
  return out;
}

/** The structure hints front-matter detection uses: PDF outline and/or EPUB TOC (#269). */
export function structureOf(src: { outline: OutlineEntry[]; epubToc?: EpubToc | null }): {
  outline: OutlineEntry[];
  epubToc?: EpubToc;
} {
  return { outline: src.outline, ...(src.epubToc ? { epubToc: src.epubToc } : {}) };
}

/**
 * #620 spike arm, from SPIKE620_ARM (spike branch only, never merged): 0 = today's prefix,
 * 1 = section-path prefix, 2 = prefix + chunks snapped to section starts, 3 = vector blend.
 */
function spikeArm(): number {
  const n = Number(process.env.SPIKE620_ARM ?? 0);
  return n === 1 || n === 2 || n === 3 ? n : 0;
}

/** Weight of the section-path vector in arm 3 (RAGFlow's title blend). */
const ARM3_PATH_WEIGHT = 0.1;

/**
 * Arms 1–3 of the #620 spike. Front matter (chunk start before the front-matter boundary) and
 * chunks outside every body section keep today's "[title › authors]" prefix.
 */
async function encodeSpikeArm(
  embedder: Embedder,
  job: EncodeJob,
  arm: number,
  hooks: EncodeHooks | undefined,
): Promise<EncodeResult> {
  const t0 = Date.now();
  const structure = structureOf(job);
  const fmEnd = frontMatterEnd(job.text, structure);
  const { sections } = bookSections(job.text, { ...structure, markdown: job.format === "epub" });
  const pathPrefixAt = (start: number): string | null =>
    start < fmEnd ? null : sectionPrefix(job.title!, sectionPathAt(sections, start));
  // Arm 3 embeds today's text; the path rides in a blended vector, so it costs no window.
  const prefixAt = (start: number): string => (arm === 3 ? job.ctx : (pathPrefixAt(start) ?? job.ctx));
  const tokens = new Map<string, number>();
  const tokensOf = (prefix: string): number => {
    let n = tokens.get(prefix);
    if (n === undefined) {
      n = embedder.countTokens(PASSAGE_PREFIX + prefix);
      tokens.set(prefix, n);
    }
    return n;
  };
  const opts = {
    budgetAt: (start: number) => Math.max(MIN_TOKEN_BUDGET, MAX_TOKENS - tokensOf(prefixAt(start))),
    lengthFn: (s: string) => embedder.countTokens(s),
  };
  let chunks: EmbedChunk[] = [];
  if (arm === 2) {
    // No chunk crosses a body-section start: each section span is cut on its own.
    const cuts = [0, ...sectionStarts(sections).filter((s) => s < job.text.length), job.text.length];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [a, b] = [cuts[i]!, cuts[i + 1]!];
      if (b <= a) continue;
      const part = await chunkForEmbeddingAsync(job.text.slice(a, b), {
        ...opts,
        budgetAt: (s: number) => opts.budgetAt(a + s),
      });
      for (const c of part) chunks.push({ body: c.body, charStart: c.charStart + a, charEnd: c.charEnd + a });
    }
  } else {
    chunks = await chunkForEmbeddingAsync(job.text, opts);
  }
  const t1 = Date.now();
  if (chunks.length === 0) return { chunks, fmEnd, phaseMs: { chunk: t1 - t0, embed: 0 } };
  const prefixes = chunks.map((c) => prefixAt(c.charStart));
  let vectors = await embedSliced(
    embedder,
    chunks.map((c, i) => prefixes[i] + c.body),
    hooks?.onEmbedProgress,
  );
  if (arm === 3) {
    const paths = chunks.map((c) => pathPrefixAt(c.charStart)?.trimEnd() ?? null);
    const distinct = [...new Set(paths.filter((p): p is string => p !== null))];
    const pv = new Map<string, Float32Array>();
    const embedded = distinct.length > 0 ? await embedder.embedPassages(distinct) : [];
    distinct.forEach((p, i) => pv.set(p, embedded[i]!));
    vectors = vectors.map((v, i) => {
      const p = paths[i] ? pv.get(paths[i]!) : undefined;
      if (!p) return v;
      const out = new Float32Array(v.length);
      for (let k = 0; k < v.length; k++) out[k] = (1 - ARM3_PATH_WEIGHT) * v[k]! + ARM3_PATH_WEIGHT * p[k]!;
      return l2normalize(out);
    });
  }
  const captionVectors =
    job.captions.length > 0 ? await embedder.embedPassages(job.captions.map((c) => job.ctx + c)) : [];
  const prefixTokens =
    arm === 3
      ? chunks.reduce((n, c) => n + tokensOf(pathPrefixAt(c.charStart) ?? job.ctx), 0)
      : prefixes.reduce((n, p) => n + tokensOf(p), 0);
  return {
    chunks,
    fmEnd,
    vectors,
    captionVectors,
    phaseMs: { chunk: t1 - t0, embed: Date.now() - t1 },
    prefixTokens,
  };
}
