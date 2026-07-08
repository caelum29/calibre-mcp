// Deterministic, model-free Embedder for harness smoke tests: hashed bag-of-words on the
// real EMBED_DIM. Lexical-only (no cross-lingual power) — it exists so CI can exercise the
// full eval plumbing in seconds without @huggingface/transformers or a model download.

import type { Embedder } from "../../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../../src/semantic/model.js";
import { l2normalize } from "../../../src/semantic/vector.js";

/** FNV-1a 32-bit — a stable, dependency-free token hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function embed(text: string): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)) {
    const slot = fnv1a(m[0]) % EMBED_DIM;
    v[slot] = (v[slot] ?? 0) + 1;
  }
  if (!v.some(Boolean)) v[0] = 1; // token-free text → fixed unit vector, not 0/0
  return l2normalize(v);
}

export const hashEmbedder: Embedder = {
  async embedQuery(text) {
    return embed(text);
  },
  async embedPassages(texts) {
    return texts.map(embed);
  },
  async warmup() {},
};
