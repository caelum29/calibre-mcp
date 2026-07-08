// Single source of truth for the embedding model (DESIGN §6 — lock the id in one place
// used by both the embedder and the index, so query- and index-time can never diverge).
// Model LOCKED to multilingual-e5-small (D-001, reaffirmed by the D-012 bake-off): 384-dim,
// 512-token window, EN+RU retrieval, and the mandatory query:/passage: prefixes from its
// model card (CLAUDE.md tech stack).
//
// The CANDIDATES table exists for embedding-model bake-offs (prompt 05): every model has its
// OWN prefix/pooling/output scheme, and getting one wrong silently tanks retrieval — so each
// entry transcribes its model card, and the embedder consumes the spec instead of hardcoding
// e5's scheme. Switching = edit ACTIVE_MODEL (code-level constant, no config surface) and
// rebuild the index (the store's meta guard refuses vectors from a different model/dim).

/** How raw model output becomes one vector — mirrors each model card's usage snippet. */
export type PoolingMode =
  | "mean" // feature-extraction pipeline, { pooling: "mean", normalize: true }
  | "cls" // feature-extraction pipeline, { pooling: "cls", normalize: true }
  | "baked-in"; // ONNX graph emits `sentence_embedding` (pooling/projection INSIDE the graph)

export interface EmbeddingModelSpec {
  /** transformers.js ONNX repo id. */
  id: string;
  /** STORED vector dimensionality. When `rawDim` is set this is the MRL-truncated width. */
  dim: number;
  /** Raw model output width for MRL entries — rows are sliced to `dim` and re-normalized. */
  rawDim?: number;
  /**
   * Chunk token budget the indexer targets. Held at 512 for every candidate — even those
   * with larger context windows — so bake-offs compare MODELS, not chunk sizes (chunk-size ×
   * model interaction is its own variable; arXiv 2505.21700). Never above the model window.
   */
  maxTokens: number;
  /** Prefix prepended to search queries (model-card mandated; "" = none). */
  queryPrefix: string;
  /** Prefix prepended to indexed passages. */
  passagePrefix: string;
  pooling: PoolingMode;
  /** ONNX weight variant to load. */
  dtype: "q8" | "fp32" | "q4";
  /** Weights license — the optional-download posture cares (docs/PRODUCT-DECISIONS.md). */
  license: string;
}

/**
 * Verified candidate table (2026-07-08 bake-off, D-012). Schemes transcribed from each
 * model card — cite chapter and verse before adding an entry.
 *
 * NOT in the table: `nomic-embed-text-v2-moe` (Apache-2.0, the strongest cross-lingual
 * candidate on paper) is UNRUNNABLE in this stack — no ONNX export exists on the Hub
 * (nomic-ai repo is sentence-transformers custom code; the only "onnx" port is an empty
 * README repo) and transformers.js 4.2.0 registers `nomic_bert` but not the MoE variant.
 * `jina-v3` excluded on license (CC BY-NC vs our MIT posture).
 */
export const CANDIDATES = {
  // intfloat/multilingual-e5-small card: asymmetric "query: "/"passage: " prefixes are
  // REQUIRED; mean pooling + L2 normalize; 384-dim; 512-token window. License MIT.
  "e5-small": {
    id: "Xenova/multilingual-e5-small",
    dim: 384,
    maxTokens: 512,
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
    pooling: "mean",
    dtype: "q8",
    license: "MIT",
  },
  // onnx-community/embeddinggemma-300m-ONNX card: prefixes "task: search result | query: "
  // (queries) and "title: none | text: " (documents); the exported graph emits
  // `sentence_embedding` — the sentence-transformers stack (mean-pool → Dense ×2 → Normalize)
  // is INSIDE the ONNX, so pipeline-side mean pooling would silently produce wrong vectors;
  // fp16 unsupported ("use fp32, q8, or q4"); 768-dim, 2048-token window (chunk budget held
  // at 512, see maxTokens doc). License: Gemma terms (use-restricted, NOT OSI).
  "gemma-768": {
    id: "onnx-community/embeddinggemma-300m-ONNX",
    dim: 768,
    maxTokens: 512,
    queryPrefix: "task: search result | query: ",
    passagePrefix: "title: none | text: ",
    pooling: "baked-in",
    dtype: "q8",
    license: "Gemma (use-restricted)",
  },
  // Same card: MRL — "truncate the output embedding of size 768 to their desired size
  // (512, 256, or 128) and then re-normalize". 256 = the 3x index-size probe.
  "gemma-256": {
    id: "onnx-community/embeddinggemma-300m-ONNX",
    dim: 256,
    rawDim: 768,
    maxTokens: 512,
    queryPrefix: "task: search result | query: ",
    passagePrefix: "title: none | text: ",
    pooling: "baked-in",
    dtype: "q8",
    license: "Gemma (use-restricted)",
  },
  // Xenova/bge-m3 card: `{ pooling: 'cls', normalize: true }`, and the BAAI/bge-m3 FAQ:
  // "no longer requires adding instructions to the queries" → no prefixes. 1024-dim,
  // 8192-token window (chunk budget held at 512). License MIT.
  "bge-m3": {
    id: "Xenova/bge-m3",
    dim: 1024,
    maxTokens: 512,
    queryPrefix: "",
    passagePrefix: "",
    pooling: "cls",
    dtype: "q8",
    license: "MIT",
  },
} as const satisfies Record<string, EmbeddingModelSpec>;

/**
 * The shipped model — bake-off switch (edit, rebuild, re-run `pnpm eval`). e5-small stays
 * LOCKED per D-012: no permissive candidate beat it on the RU axis without regressing EN
 * (see test/eval/retrieval/reports/2026-07-08-model-bakeoff.md).
 */
export const ACTIVE_MODEL: EmbeddingModelSpec = CANDIDATES["e5-small"];

/** Xenova ONNX port used by transformers.js (CPU). */
export const MODEL_ID = ACTIVE_MODEL.id;

/** Embedding dimensionality → dim × Float32 LE bytes per stored vector (384 → 1536 B). */
export const EMBED_DIM = ACTIVE_MODEL.dim;

/** Chunk token budget (≤ model window); passages truncate here (silent, not an error). */
export const MAX_TOKENS = ACTIVE_MODEL.maxTokens;

// e5 REQUIRES asymmetric prefixes: "query: " on searches, "passage: " on indexed text.
// Skipping them silently degrades retrieval, so they are prepended inside the embedder.
export const QUERY_PREFIX = ACTIVE_MODEL.queryPrefix;
export const PASSAGE_PREFIX = ACTIVE_MODEL.passagePrefix;

/**
 * Bumped on any pipeline change (model, prefixes, pooling, chunking) that invalidates
 * stored vectors. The store refuses to read an index whose meta.index_version differs,
 * forcing a rebuild instead of silently mixing incompatible vectors. (Model swaps are
 * additionally caught by the meta model_id/dim keys — switching ACTIVE_MODEL refuses an
 * old index even at the same index_version.)
 *
 * v2 (increment 4): added the FTS5 keyword half — a `body_stem` column + `chunk_fts`
 * virtual table. A v1 index lacks both, so it must be rebuilt to gain hybrid search.
 *
 * v3 (chunking v3): chunk overlap removed (measured: no retrieval benefit, ~13% chunk
 * inflation) and budgets counted in real model tokens via the embedder's tokenizer —
 * every chunk boundary moves, so v2 vectors/offsets must be rebuilt. Folded into the same
 * (unshipped) bump: a `book_meta` FTS column (stemmed title+authors on chunks/chunk_fts,
 * bm25-weighted 0.5) so the keyword half sees book identity, not just prose.
 */
export const INDEX_VERSION = 3;
