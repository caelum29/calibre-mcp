// Single source of truth for the embedding model (DESIGN §6 — lock the id in one place
// used by both the embedder and the index, so query- and index-time can never diverge).
// Model LOCKED to multilingual-e5-small: 384-dim, 512-token window, EN+RU retrieval, and
// the mandatory query:/passage: prefixes from its model card (CLAUDE.md tech stack).

/** Xenova ONNX port used by transformers.js (CPU). */
export const MODEL_ID = "Xenova/multilingual-e5-small";

/** Embedding dimensionality → 384 × Float32 LE = 1536 bytes per stored vector. */
export const EMBED_DIM = 384;

/** Model context window in tokens; passages truncate here (silent, not an error). */
export const MAX_TOKENS = 512;

// e5 REQUIRES asymmetric prefixes: "query: " on searches, "passage: " on indexed text.
// Skipping them silently degrades retrieval, so they are prepended inside the embedder.
export const QUERY_PREFIX = "query: ";
export const PASSAGE_PREFIX = "passage: ";

/**
 * Bumped on any pipeline change (model, prefixes, pooling, chunking) that invalidates
 * stored vectors. The store refuses to read an index whose meta.index_version differs,
 * forcing a rebuild instead of silently mixing incompatible vectors.
 */
export const INDEX_VERSION = 1;
