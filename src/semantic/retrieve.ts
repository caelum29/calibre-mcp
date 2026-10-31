// Retrieval application service (#259): the ranking half of calibre_semantic_search, free of
// MCP rendering. Per scope (library books / book passages / figure captions) and mode it runs
// the vector + keyword halves, RRF-fuses them (hybrid), applies the cross-encoder rerank stage
// (D-011), the front-matter demotion (#18) and the two confidence signals. The tool adapter
// only resolves args/filters, calls retrieve() and renders; the eval harness calls it directly.

import type { Config } from "../config.js";
import type { LogSink } from "../logging.js";
import type { Embedder } from "./embedder.js";
import { RRF_K, rrfFuse } from "./fusion.js";
import { RERANK_FLOOR, RERANK_POOL, type Reranker } from "./reranker.js";
import { stemText } from "./stem.js";
import { snippetWindow } from "./snippet.js";
import type { BookHit, ChunkIndex, FigureHit, FigureIndex, LibraryHit } from "./store/index.js";

/** Per-half candidate pool the fuser draws from (design: vector top-50 + keyword top-50). */
const POOL = 50;

// Weighted-RRF per-source weights for hybrid fusion. Both 1.0 = plain RRF; no config/env
// surface — change them ONLY on retrieval-eval evidence (test/eval/retrieval), never by feel.
// #142 sweep (1.0–2.0, D-021): RU flat at k=60, EN exact-identifier regresses → 1.0 stays.
// Sweeps pass candidate weights via retrieve()'s opts.rrfWeights instead of editing these.
const VECTOR_RRF_WEIGHT = 1.0;
const KEYWORD_RRF_WEIGHT = 1.0;
const RRF_WEIGHTS: readonly number[] = [VECTOR_RRF_WEIGHT, KEYWORD_RRF_WEIGHT];

// Figures cosine floor (D-018/#83): the chunk-calibrated config.semanticFloor (0.78) does NOT
// transfer to short captions — cosine scales are corpus-dependent (D-012). Disabled (null)
// until the #85 two-tier calibration (fixture tier: flags 100% of figure-negatives, zeroes no
// positive; live tier decides enabling). Until then only the reranker floor signals confidence.
const FIGURES_SEMANTIC_FLOOR: number | null = null;

const FIGURES_FLOOR_NOTE = "Figure-caption cosine floor not yet calibrated — lowConfidence reflects the reranker only.";

// Kept brief on purpose (#47): the reranker degrade is advisory, not a hard stop — point at the
// same @huggingface/transformers dependency + restart rule without inlining the full 3-branch text.
const RERANK_NOTE =
  "Reranker unavailable — results keep the fused (pre-rerank) order. The cross-encoder model needs " +
  "@huggingface/transformers (see calibre_build_index for install steps) and downloads on first use; " +
  "if you just installed it, restart the MCP server, and ensure the machine is online.";

// #156: concurrent searches past the reranker's queue cap skip the rerank instead of waiting
// past the client timeout — the results are still useful, just in fused order.
const RERANK_BUSY_NOTE =
  "Reranker busy with other concurrent searches — results keep the fused (pre-rerank) order. " +
  "For reranked results, issue library-scope semantic searches one at a time.";

const RERANK_DISABLED_NOTE = "Reranking disabled via CALIBRE_MCP_RERANK — results keep the fused (pre-rerank) order.";

/** Retrieval mode: hybrid = RRF of both halves; vector / keyword = one half each. */
export type RetrievalMode = "hybrid" | "vector" | "keyword";

/** What retrieve() needs — a structural subset of ToolDeps, so tools pass theirs as-is. */
export interface RetrievalDeps {
  /** Only the retrieval ports (#272): chunk + figure search, never writes or freshness. */
  index: ChunkIndex & FigureIndex;
  embedder: Embedder;
  /** Absent = reranking not wired → the fused order is kept silently. */
  reranker?: Reranker;
  config: Pick<Config, "rerankEnabled" | "semanticFloor">;
  log: LogSink;
}

interface BaseRequest {
  libraryId: string;
  query: string;
  mode: RetrievalMode;
  topK: number;
}

/** Rank BOOKS by their best-matching passage, optionally restricted to an allowed id set. */
export interface LibraryRequest extends BaseRequest {
  scope: "library";
  allow?: ReadonlySet<number>;
}

/** Rank PASSAGES within one indexed book. */
export interface BookRequest extends BaseRequest {
  scope: "book";
  bookId: number;
}

/** Rank figure captions library-wide (allow-restricted) or within one book. */
export interface FiguresRequest extends BaseRequest {
  scope: "figures";
  bookId?: number;
  allow?: ReadonlySet<number>;
}

export type RetrievalRequest = LibraryRequest | BookRequest | FiguresRequest;

/** Tuning knobs for eval sweeps; production calls pass none. */
export interface RetrievalOptions {
  /** Weighted-RRF weights, vector first then keyword (default 1.0 / 1.0). */
  rrfWeights?: readonly number[];
}

/** One ranked hit plus the scores that produced its position. */
export interface Ranked<H> {
  hit: H;
  /** Cosine, when the vector half contributed this hit (absent for keyword-only). */
  cosine?: number;
  /** Cross-encoder sigmoid score, set when the rerank stage reordered this hit. */
  rerankScore?: number;
}

/** retrieve()'s outcome: topK hits in emitted order + the honesty fields the adapter renders. */
export interface RankedHits<H> {
  hits: Ranked<H>[];
  reranked: boolean;
  maxRerank?: number;
  /** Max cosine across the hits (absent when no hit has one). */
  maxScore?: number;
  lowConfidence: boolean;
  /** Advisory notes in display order (rerank degrade, front-matter demotion, figures floor). */
  notes: string[];
}

/**
 * Rank hits for one request: candidate pools per mode, RRF fusion (hybrid), the rerank stage,
 * scope-specific post-processing, and confidence. Throws the embedder/index error codes
 * (`EMBEDDER_UNAVAILABLE`, `INDEX_INCOMPATIBLE…`) for the adapter to map; rerank failures degrade.
 */
export function retrieve(
  deps: RetrievalDeps,
  req: LibraryRequest,
  opts?: RetrievalOptions,
): Promise<RankedHits<LibraryHit>>;
/** scope=book: passages within one book, front matter demoted below body matches (#18). */
export function retrieve(deps: RetrievalDeps, req: BookRequest, opts?: RetrievalOptions): Promise<RankedHits<BookHit>>;
/** scope=figures: figure captions, library-wide or within one book (#83). */
export function retrieve(
  deps: RetrievalDeps,
  req: FiguresRequest,
  opts?: RetrievalOptions,
): Promise<RankedHits<FigureHit>>;
/** Implementation: dispatch on scope; see the overloads for the per-scope hit types. */
export async function retrieve(
  deps: RetrievalDeps,
  req: RetrievalRequest,
  opts: RetrievalOptions = {},
): Promise<RankedHits<LibraryHit> | RankedHits<BookHit> | RankedHits<FigureHit>> {
  const weights = opts.rrfWeights ?? RRF_WEIGHTS;
  if (req.scope === "library") {
    const rr = await applyRerank(await rankBooks(req, deps, weights), (r) => r.hit.body, req, deps);
    // Display only (#243): re-cut each snippet around the query terms after ranking is final.
    const hits = rr.hits.map((r) => ({ ...r, hit: withSnippet(r.hit, req.query) }));
    return outcome(rr, hits, confidence(hits, deps, rr), rr.note);
  }
  if (req.scope === "book") {
    const rr = await applyRerank(await rankPassages(req, deps, weights), (r) => r.hit.body, req, deps);
    // Front-matter demotion (issue #18): TOC/praise/foreword chunks are keyword-dense but
    // semantically empty, so they win exactly the definitional queries where body content is
    // wanted. Stable-partition AFTER the rerank — body passages first, front matter after,
    // internal order preserved; nothing is dropped ("what does the foreword say" still works).
    const demoted = rr.hits.filter((r) => r.hit.frontMatter).length;
    const hits =
      demoted > 0
        ? [...rr.hits.filter((r) => !r.hit.frontMatter), ...rr.hits.filter((r) => r.hit.frontMatter)]
        : rr.hits;
    const demotedNote =
      demoted > 0 ? `${demoted} front-matter passage(s) (TOC/praise/foreword) demoted below body matches.` : undefined;
    return outcome(rr, hits, confidence(hits, deps, rr), rr.note, demotedNote);
  }
  const rr = await applyRerank(await rankFigures(req, deps, weights), (r) => r.hit.caption, req, deps);
  const floorNote =
    req.mode !== "keyword" && rr.hits.length > 0 && FIGURES_SEMANTIC_FLOOR === null ? FIGURES_FLOOR_NOTE : undefined;
  return outcome(rr, rr.hits, figuresConfidence(rr.hits, rr), rr.note, floorNote);
}

/** A library hit whose snippet is the query-term window of its chunk, with its book offset. */
function withSnippet(hit: LibraryHit, query: string): LibraryHit {
  const w = snippetWindow(hit.body, query);
  return { ...hit, snippet: w.text, snippetStart: hit.charStart + w.start };
}

/** Assemble the public result from the rerank outcome, final hit order and confidence. */
function outcome<H>(
  rr: RerankOutcome<unknown>,
  hits: Ranked<H>[],
  conf: { maxScore?: number; lowConfidence: boolean },
  ...notes: Array<string | undefined>
): RankedHits<H> {
  return {
    hits,
    reranked: rr.reranked,
    ...(rr.maxRerank !== undefined ? { maxRerank: rr.maxRerank } : {}),
    ...(conf.maxScore !== undefined ? { maxScore: conf.maxScore } : {}),
    lowConfidence: conf.lowConfidence,
    notes: notes.filter((n): n is string => Boolean(n)),
  };
}

/** Candidates to materialize: a rerank-sized pool when the reranker can reorder, else topK. */
function poolK(req: BaseRequest, deps: RetrievalDeps): number {
  return rerankActive(req, deps) ? Math.max(req.topK, RERANK_POOL) : req.topK;
}

/** True when the rerank stage will run: a reranker is wired, not env-disabled, mode has a semantic claim. */
function rerankActive(req: BaseRequest, deps: RetrievalDeps): boolean {
  return Boolean(deps.reranker) && deps.config.rerankEnabled && req.mode !== "keyword";
}

/** The two candidate halves of one hybrid ranking, keyed on `idOf` for fusion. */
interface Halves<H> {
  vec: Array<H & { score: number }>;
  kw: H[];
  idOf: (h: H) => number;
}

/** RRF-fuse a vector and a keyword ranking, keeping the vector hit (and its cosine) when both have it. */
function fuse<H>({ vec, kw, idOf }: Halves<H>, k: number, w: readonly number[]): Ranked<H>[] {
  const vById = new Map(vec.map((h) => [idOf(h), h]));
  const kById = new Map(kw.map((h) => [idOf(h), h]));
  return rrfFuse([vec.map(idOf), kw.map(idOf)], RRF_K, [...w])
    .slice(0, k)
    .map((f): Ranked<H> => {
      const v = vById.get(f.id);
      return { hit: (v ?? kById.get(f.id))!, cosine: v?.score };
    });
}

/** Rank books per mode. hybrid RRF-fuses the two halves; vector/keyword use one half each. */
async function rankBooks(
  req: LibraryRequest,
  deps: RetrievalDeps,
  w: readonly number[],
): Promise<Ranked<LibraryHit>[]> {
  const { libraryId, allow } = req;
  if (req.mode === "keyword") {
    return deps.index.searchLibraryFts(libraryId, stemText(req.query), req.topK, allow).map((hit) => ({ hit }));
  }
  const k = poolK(req, deps);
  const q = await deps.embedder.embedQuery(req.query);
  if (req.mode === "vector") {
    return deps.index.searchLibrary(libraryId, q, k, allow).map((hit) => ({ hit, cosine: hit.score }));
  }
  // hybrid: fuse book rankings from both halves by bookId (vector first — weights order).
  const vec = deps.index.searchLibrary(libraryId, q, POOL, allow);
  const kw = deps.index.searchLibraryFts(libraryId, stemText(req.query), POOL, allow);
  return fuse({ vec, kw, idOf: (h) => h.bookId }, k, w);
}

/** Rank passages within one book per mode, mirroring rankBooks but fusing on chunkId. */
async function rankPassages(req: BookRequest, deps: RetrievalDeps, w: readonly number[]): Promise<Ranked<BookHit>[]> {
  const { libraryId, bookId } = req;
  if (req.mode === "keyword") {
    return deps.index.searchBookFts(libraryId, bookId, stemText(req.query), req.topK).map((hit) => ({ hit }));
  }
  const k = poolK(req, deps);
  const q = await deps.embedder.embedQuery(req.query);
  if (req.mode === "vector") {
    return deps.index.searchBook(libraryId, bookId, q, k).map((hit) => ({ hit, cosine: hit.score }));
  }
  const vec = deps.index.searchBook(libraryId, bookId, q, POOL);
  const kw = deps.index.searchBookFts(libraryId, bookId, stemText(req.query), POOL);
  return fuse({ vec, kw, idOf: (h) => h.chunkId }, k, w);
}

/** Rank figure captions per mode — the rankBooks/rankPassages mirror, fused on figureId. */
async function rankFigures(
  req: FiguresRequest,
  deps: RetrievalDeps,
  w: readonly number[],
): Promise<Ranked<FigureHit>[]> {
  const { libraryId, bookId, allow } = req;
  if (req.mode === "keyword") {
    return deps.index.searchFiguresFts(libraryId, stemText(req.query), req.topK, bookId, allow).map((hit) => ({ hit }));
  }
  const k = poolK(req, deps);
  const q = await deps.embedder.embedQuery(req.query);
  if (req.mode === "vector") {
    return deps.index.searchFigures(libraryId, q, k, bookId, allow).map((hit) => ({ hit, cosine: hit.score }));
  }
  const vec = deps.index.searchFigures(libraryId, q, POOL, bookId, allow);
  const kw = deps.index.searchFiguresFts(libraryId, stemText(req.query), POOL, bookId, allow);
  return fuse({ vec, kw, idOf: (h) => h.figureId }, k, w);
}

/** The rerank stage's outcome: topK results (reordered when it ran) + honesty fields. */
interface RerankOutcome<T> {
  hits: T[];
  reranked: boolean;
  maxRerank?: number;
  note?: string;
}

/**
 * Cross-encoder rerank (D-011): score (query, chunk body) pairs over the top-RERANK_POOL fused
 * candidates and emit them by reranker score; fused candidates past the cap keep their fused
 * order after the reranked head (no rerank score claimed — the latency guard at high topK).
 * Always-on for hybrid/vector when a reranker is wired (CALIBRE_MCP_RERANK=off opts out);
 * keyword mode skips it. Degrades (never fails): errors fall back to the fused order + a note.
 */
async function applyRerank<T extends { rerankScore?: number }>(
  pool: T[],
  bodyOf: (r: T) => string,
  req: BaseRequest,
  deps: RetrievalDeps,
): Promise<RerankOutcome<T>> {
  const fused = () => pool.slice(0, req.topK);
  // Absent reranker = not wired in this deployment/test — silently keep the fused order.
  if (req.mode === "keyword" || pool.length === 0 || !deps.reranker) {
    return { hits: fused(), reranked: false };
  }
  // Env-disabled = a deliberate user choice — same degrade shape, but say why (D-011).
  if (!deps.config.rerankEnabled) {
    return { hits: fused(), reranked: false, note: RERANK_DISABLED_NOTE };
  }
  try {
    const head = pool.slice(0, RERANK_POOL);
    const t0 = performance.now();
    const scores = await deps.reranker.rerank(
      req.query,
      head.map((r) => bodyOf(r)),
    );
    deps.log.debug("rerank stage", { pairs: head.length, ms: Math.round(performance.now() - t0) });
    const scored = head.map((r, i) => ({ ...r, rerankScore: scores[i] ?? 0 }));
    scored.sort((a, b) => b.rerankScore - a.rerankScore); // stable: ties keep fused order
    const hits = [...scored, ...pool.slice(RERANK_POOL)].slice(0, req.topK);
    return { hits, reranked: true, maxRerank: scored[0]?.rerankScore };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log.warn("rerank skipped", { reason });
    return { hits: fused(), reranked: false, note: reason === "RERANKER_BUSY" ? RERANK_BUSY_NOTE : RERANK_NOTE };
  }
}

/**
 * Two confidence signals, kept separate (not conflated): the cosine floor judges the COSINE
 * half only; the reranker's sigmoid score is its own calibrated confidence (< RERANK_FLOOR ≈
 * weak). Either signal alone marks the result set low-confidence; both raw maxima are surfaced.
 */
function confidence(ranked: Array<{ cosine?: number }>, deps: RetrievalDeps, rr: RerankOutcome<unknown>) {
  const cosines = ranked.map((r) => r.cosine).filter((c): c is number => c !== undefined);
  const maxScore = cosines.length ? Math.max(...cosines) : undefined;
  const cosineLow = maxScore !== undefined && maxScore < deps.config.semanticFloor;
  const rerankLow = rr.reranked && rr.maxRerank !== undefined && rr.maxRerank < RERANK_FLOOR;
  return { maxScore, lowConfidence: cosineLow || rerankLow };
}

/**
 * Figures confidence: the chunk cosine floor does not apply (FIGURES_SEMANTIC_FLOOR is its
 * own, currently-disabled constant), so until calibration only the reranker floor signals.
 */
function figuresConfidence(ranked: Array<{ cosine?: number }>, rr: RerankOutcome<unknown>) {
  const cosines = ranked.map((r) => r.cosine).filter((c): c is number => c !== undefined);
  const maxScore = cosines.length ? Math.max(...cosines) : undefined;
  const cosineLow = FIGURES_SEMANTIC_FLOOR !== null && maxScore !== undefined && maxScore < FIGURES_SEMANTIC_FLOOR;
  const rerankLow = rr.reranked && rr.maxRerank !== undefined && rr.maxRerank < RERANK_FLOOR;
  return { maxScore, lowConfidence: cosineLow || rerankLow };
}
