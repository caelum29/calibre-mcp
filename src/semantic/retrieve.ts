// Retrieval application service (#259): the ranking half of calibre_semantic_search, free of
// MCP rendering. The tool adapter resolves args/filters, calls retrieve() and renders; the eval
// harness calls it directly.

import type { Config } from "../config.js";
import { isStrongMatter, type MatterKind } from "../domain/structure/matter-kind.js";
import type { LogSink } from "../logging.js";
import type { Embedder } from "./embedder.js";
import { RRF_K, rrfFuse } from "./fusion.js";
import { ADAPTIVE_AGREE_TOP, ADAPTIVE_RERANK_POOL, RERANK_FLOOR, RERANK_POOL, type Reranker } from "./reranker.js";
import { LIBRARY_SNIPPET_CHARS, snippetWindow } from "./snippet.js";
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

// Library rerank candidates (#604, Fix A): fusion keys books, so a book in both halves would only
// show the cross-encoder its vector chunk. Its keyword chunk joins as a second candidate, but only
// for the keyword half's top books: a second candidate for every book would, under the 30-pair
// cap, halve the books the reranker sees (Artem, grilling 2026-11-16).
const KEYWORD_CANDIDATE_BOOKS = 5;

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

/**
 * Of these hit books, the ones the library no longer holds (#579). Runs after the rerank and
 * before confidence, so a dropped hit's scores never speak for the rest. Must not throw.
 */
export type GoneBooks = (bookIds: readonly number[]) => Promise<ReadonlySet<number>>;

/** Rank BOOKS by their best-matching passage, optionally restricted to an allowed id set. */
export interface LibraryRequest extends BaseRequest {
  scope: "library";
  allow?: ReadonlySet<number>;
  gone?: GoneBooks;
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
  gone?: GoneBooks;
}

export type RetrievalRequest = LibraryRequest | BookRequest | FiguresRequest;

/**
 * Tuning knobs for eval sweeps and the #644 rerank latency A/B; production calls pass none. Only
 * in-process scripts set them (BuildServerOptions.retrievalOptions) — never an env var or tool param.
 */
export interface RetrievalOptions {
  /** Weighted-RRF weights, vector first then keyword (default 1.0 / 1.0). */
  rrfWeights?: readonly number[];
  /** Cross-encoded pair cap and rerank candidate count (default RERANK_POOL). */
  rerankPool?: number;
  /** Pair truncation length passed to the reranker (default: the reranker's own, 512). */
  rerankMaxTokens?: number;
  /** Hybrid only: halves agreeing on their top ADAPTIVE_AGREE_TOP ids cut the rerank to ADAPTIVE_RERANK_POOL pairs. */
  adaptivePool?: boolean;
}

/** One call's resolved rerank knobs (#644): pair cap, truncation length, adaptive rule on/off. */
interface RerankKnobs {
  pool: number;
  maxTokens?: number;
  adaptive: boolean;
}

/** Fused candidates plus the pair cap the rerank stage applies to them (smaller under the adaptive rule). */
interface Candidates<H> {
  items: Pooled<H>[];
  cut: number;
}

/**
 * How a hit got its place (#650), for debug output: 1-based ranks in each half's candidate list
 * and after fusion, and whether the cross-encoder scored it. Ranks are absent when the unit was
 * not in that list or the stage did not run.
 */
export interface HitProvenance {
  vectorRank?: number;
  keywordRank?: number;
  /** Hybrid only. */
  fusedRank?: number;
  /** True when the cross-encoder scored this hit (a library book: at least one of its candidates). */
  rerankPool: boolean;
  /** Library hybrid only: the half whose best chunk is shown ("both" when it is the same chunk). */
  chunkFrom?: "vector" | "keyword" | "both";
  /** Library only: the rerank score of the book's other candidate chunk, when two were scored (#604). */
  otherRerankScore?: number;
}

/** One ranked hit plus the scores that produced its position. */
export interface Ranked<H> {
  hit: H;
  /**
   * Cosine, when the vector half contributed this item (absent for keyword-only). Library: the
   * book's vector-best chunk, even when the rerank kept its keyword chunk as the hit (#604).
   */
  cosine?: number;
  /** Cross-encoder sigmoid score, set when the rerank stage reordered this hit. */
  rerankScore?: number;
  /** Set by retrieve() on every hit; the adapter shows it only at debug level (#650). */
  provenance?: HitProvenance;
}

/** retrieve()'s outcome: topK hits in emitted order + the honesty fields the adapter renders. */
export interface RankedHits<H> {
  hits: Ranked<H>[];
  reranked: boolean;
  maxRerank?: number;
  /** Max cosine across the hits (absent when no hit has one). */
  maxScore?: number;
  lowConfidence: boolean;
  /** Advisory notes in display order (rerank degrade, front/back-matter placement, figures floor). */
  notes: string[];
}

/**
 * Rank hits for one request. Per scope (library books / book passages / figure captions) and mode
 * it runs the vector + keyword halves, RRF-fuses them (hybrid), applies the cross-encoder rerank
 * stage (D-011), the front-matter demotion (#18) and the two confidence signals. Throws the
 * embedder/index error codes (`EMBEDDER_UNAVAILABLE`, `INDEX_INCOMPATIBLE…`) for the adapter to map;
 * rerank failures degrade.
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
  const knobs: RerankKnobs = {
    pool: opts.rerankPool ?? RERANK_POOL,
    ...(opts.rerankMaxTokens !== undefined ? { maxTokens: opts.rerankMaxTokens } : {}),
    adaptive: opts.adaptivePool === true,
  };
  if (req.scope === "library") {
    const rr = await dropGone(
      await applyRerank(await rankBooks(req, deps, weights, knobs), req, deps, knobs, {
        body: (h) => h.body,
        tie: (h) => [h.bookId, h.bookId],
        tier: tierOf,
        weakAfterBody: true,
      }),
      req.gone,
      isBodyHit,
    );
    // Display only (#243): re-cut each snippet around the query terms after ranking is final.
    const hits = rr.hits.map((r) => ({ ...r, hit: withSnippet(r.hit, req.query) }));
    // Library scope places every non-body book after the body books, reranked or not (#605).
    const placed = hits.some((r) => isBodyHit(r.hit)) ? hits.filter((r) => !isBodyHit(r.hit)).length : 0;
    return outcome(rr, hits, confidence(hits, deps.config.semanticFloor, rr), rr.note, placedNote(placed));
  }
  if (req.scope === "book") {
    // Front/back matter (#18, #605): contents, index and copyright pages are keyword-dense but
    // semantically empty, so they stay out of the rerank and follow the body passages; a preface
    // is real content and keeps its rerank position. Nothing is dropped.
    const rr = await applyRerank(await rankPassages(req, deps, weights, knobs), req, deps, knobs, {
      body: (h) => h.body,
      tie: (h) => [0, h.chunkId], // one book: passages tie-break on chunk id alone
      tier: tierOf,
      weakAfterBody: false,
    });
    const moved = (h: BookHit) => tierOf(h) === "strong" || (!rr.reranked && tierOf(h) === "weak");
    const placed = rr.hits.some((r) => isBodyHit(r.hit)) ? rr.hits.filter((r) => moved(r.hit)).length : 0;
    return outcome(rr, rr.hits, confidence(rr.hits, deps.config.semanticFloor, rr), rr.note, placedNote(placed));
  }
  const rr = await dropGone(
    await applyRerank(await rankFigures(req, deps, weights, knobs), req, deps, knobs, {
      body: (h) => h.caption,
      tie: (h) => [h.bookId, h.figureId],
      tier: () => "body", // figures scope is unchanged by the matter rules
      weakAfterBody: false,
    }),
    req.gone,
  );
  const floorNote =
    req.mode !== "keyword" && rr.hits.length > 0 && FIGURES_SEMANTIC_FLOOR === null ? FIGURES_FLOOR_NOTE : undefined;
  return outcome(rr, rr.hits, confidence(rr.hits, FIGURES_SEMANTIC_FLOOR, rr), rr.note, floorNote);
}

/**
 * How the matter rules place a hit (#605): body; weak (a bibliography, prose front matter) is
 * reranked but may follow body hits; strong (index, copyright/ads, prose-less front) takes no
 * rerank pair and follows the reranked hits.
 */
type Tier = "body" | "weak" | "strong";

/** The tier of a chunk hit from its matter kind and text (absent kind = body). */
function tierOf(h: { matterKind?: MatterKind; body: string }): Tier {
  const kind = h.matterKind ?? "body";
  if (kind === "body") return "body";
  return isStrongMatter(kind, h.body) ? "strong" : "weak";
}

/** True for a body chunk hit (absent kind = body). */
function isBodyHit(h: { matterKind?: MatterKind; body: string }): boolean {
  return tierOf(h) === "body";
}

/**
 * The confidence rerank score (#605): the best one among the body hits, the tier shown first;
 * among all reranked hits only when no body hit was reranked. Book scope passes no `isBody`:
 * weak passages keep their rerank position there, so the best reranked hit is the one shown.
 */
function maxRerankOf<H>(hits: { hit: H; rerankScore?: number }[], isBody?: (h: H) => boolean) {
  const scored = hits.filter((r) => r.rerankScore !== undefined);
  const body = isBody ? scored.filter((r) => isBody(r.hit)) : scored;
  const pick = body.length > 0 ? body : scored;
  return pick.length > 0 ? Math.max(...pick.map((r) => r.rerankScore!)) : undefined;
}

/** The note for hits the matter rules placed after body matches; none when nothing moved. */
function placedNote(n: number): string | undefined {
  return n > 0 ? `${n} front/back-matter passage(s) placed after body matches.` : undefined;
}

/** A library hit whose snippet is the query-term window of its chunk, with its book offset. */
function withSnippet(hit: LibraryHit, query: string): LibraryHit {
  const w = snippetWindow(hit.body, query, LIBRARY_SNIPPET_CHARS);
  return { ...hit, snippet: w.text, snippetStart: hit.charStart + w.start };
}

/** Assemble the public result from the rerank outcome, final hit order and confidence. */
function outcome<H>(
  rr: RerankOutcome<unknown>,
  hits: Ranked<H>[],
  conf: { maxScore?: number; lowConfidence: boolean },
  ...notes: (string | undefined)[]
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
function poolK(req: BaseRequest, deps: RetrievalDeps, pool: number): number {
  return rerankActive(req, deps) ? Math.max(req.topK, pool) : req.topK;
}

/**
 * The pair cap for a hybrid ranking (#644): the knob's pool, or ADAPTIVE_RERANK_POOL when the
 * adaptive rule is on and both halves hold the same top ADAPTIVE_AGREE_TOP ids in any order. A
 * keyword half with fewer ids than that counts as no agreement.
 */
function hybridCut<H>(knobs: RerankKnobs, vec: H[], kw: H[], idOf: (h: H) => number): number {
  if (!knobs.adaptive) return knobs.pool;
  const top = (list: H[]) => [...new Set(list.map(idOf))].slice(0, ADAPTIVE_AGREE_TOP);
  const v = top(vec);
  const k = new Set(top(kw));
  const agree = k.size === ADAPTIVE_AGREE_TOP && v.length === ADAPTIVE_AGREE_TOP && v.every((id) => k.has(id));
  return agree ? Math.min(ADAPTIVE_RERANK_POOL, knobs.pool) : knobs.pool;
}

/** True when the rerank stage will run: a reranker is wired, not env-disabled, mode has a semantic claim. */
function rerankActive(req: BaseRequest, deps: RetrievalDeps): boolean {
  return Boolean(deps.reranker) && deps.config.rerankEnabled && req.mode !== "keyword";
}

/**
 * The two candidate halves of one hybrid ranking, keyed on `idOf` for fusion. `tieOf` is the
 * (book id, unit id) order for equal fused scores, the same key the vector, FTS and rerank
 * stages use (#392, #457).
 */
interface Halves<H> {
  vec: (H & { score: number })[];
  kw: H[];
  idOf: (h: H) => number;
  tieOf: (h: H) => readonly [number, number];
}

/** RRF-fuse a vector and a keyword ranking, keeping the vector hit (and its cosine) when both have it. */
function fuse<H>({ vec, kw, idOf, tieOf }: Halves<H>, k: number, w: readonly number[]): Ranked<H>[] {
  const vById = new Map(vec.map((h) => [idOf(h), h]));
  const kById = new Map(kw.map((h) => [idOf(h), h]));
  const hitOf = (id: number): H => (vById.get(id) ?? kById.get(id))!;
  // re-sort before the cut: rrfFuse breaks ties by the fused id alone, which for figures (fused
  // on the row id) need not follow book order (#457)
  const fused = rrfFuse([vec.map(idOf), kw.map(idOf)], RRF_K, [...w]).sort((a, b) => {
    const [ab, au] = tieOf(hitOf(a.id));
    const [bb, bu] = tieOf(hitOf(b.id));
    return b.score - a.score || ab - bb || au - bu;
  });
  const vRank = rankMap(vec, idOf);
  const kRank = rankMap(kw, idOf);
  return fused.slice(0, k).map((f, i): Ranked<H> => {
    const v = vById.get(f.id);
    const provenance: HitProvenance = {
      ...(vRank.has(f.id) ? { vectorRank: vRank.get(f.id) } : {}),
      ...(kRank.has(f.id) ? { keywordRank: kRank.get(f.id) } : {}),
      fusedRank: i + 1,
      rerankPool: false,
    };
    return { hit: hitOf(f.id), cosine: v?.score, provenance };
  });
}

/** id → 1-based position in one half's candidate list. */
function rankMap<H>(list: H[], idOf: (h: H) => number): Map<number, number> {
  const out = new Map<number, number>();
  list.forEach((h, i) => {
    if (!out.has(idOf(h))) out.set(idOf(h), i + 1);
  });
  return out;
}

/** One half's hits as ranked items with their half rank (keyword/vector modes, #650). */
function single<H>(hits: (H & { score: number })[], half: "vector" | "keyword"): Ranked<H>[] {
  return hits.map((hit, i) =>
    half === "vector"
      ? { hit, cosine: hit.score, provenance: { vectorRank: i + 1, rerankPool: false } }
      : { hit, provenance: { keywordRank: i + 1, rerankPool: false } },
  );
}

/** Rank books per mode. hybrid RRF-fuses the two halves; vector/keyword use one half each. */
async function rankBooks(
  req: LibraryRequest,
  deps: RetrievalDeps,
  w: readonly number[],
  knobs: RerankKnobs,
): Promise<Candidates<LibraryHit>> {
  const { libraryId, allow } = req;
  const cut = knobs.pool;
  if (req.mode === "keyword") {
    return { items: single(deps.index.searchLibraryFts(libraryId, req.query, req.topK, allow), "keyword"), cut };
  }
  const k = poolK(req, deps, knobs.pool);
  const q = await deps.embedder.embedQuery(req.query);
  if (req.mode === "vector") {
    return { items: single(deps.index.searchLibrary(libraryId, q, k, allow), "vector"), cut };
  }
  // hybrid: fuse book rankings from both halves by bookId (vector first — weights order).
  const vec = deps.index.searchLibrary(libraryId, q, POOL, allow);
  const kw = deps.index.searchLibraryFts(libraryId, req.query, POOL, allow);
  const fused = withChunkSource(fuse({ vec, kw, idOf: (h) => h.bookId, tieOf: (h) => [h.bookId, h.bookId] }, k, w), kw);
  return {
    items: rerankActive(req, deps) ? withKeywordCandidates(fused, kw) : fused,
    cut: hybridCut(knobs, vec, kw, (h) => h.bookId),
  };
}

/** Record which half's best chunk a fused book shows (#650): vector, keyword, or the same chunk in both. */
function withChunkSource(fused: Ranked<LibraryHit>[], kw: LibraryHit[]): Ranked<LibraryHit>[] {
  const kById = new Map(kw.map((h) => [h.bookId, h]));
  return fused.map((r) => {
    const k = kById.get(r.hit.bookId);
    // a cosine marks the vector half's hit (fuse keeps it when both halves have the book)
    const chunkFrom = r.cosine === undefined ? "keyword" : k?.chunkId === r.hit.chunkId ? "both" : "vector";
    return { ...r, provenance: { ...r.provenance!, chunkFrom } };
  });
}

/**
 * Give a fused book its keyword-half chunk as a second rerank candidate (#604) when the book is
 * in both halves, the two halves picked different chunks, both are body chunks (#605), and the
 * book is in the keyword half's top KEYWORD_CANDIDATE_BOOKS. The vector chunk stays the main
 * candidate, so it keeps the book on equal scores.
 */
function withKeywordCandidates(fused: Ranked<LibraryHit>[], kw: LibraryHit[]): Pooled<LibraryHit>[] {
  const kwTop = new Map(kw.slice(0, KEYWORD_CANDIDATE_BOOKS).map((h) => [h.bookId, h]));
  return fused.map((r) => {
    const k = kwTop.get(r.hit.bookId);
    // a cosine marks the vector half's hit; a keyword-only book already shows its keyword chunk
    if (r.cosine === undefined || !k || k.chunkId === r.hit.chunkId) return r;
    if (tierOf(r.hit) !== "body" || tierOf(k) !== "body") return r;
    return { ...r, keywordAlt: k };
  });
}

/** Rank passages within one book per mode, mirroring rankBooks but fusing on chunkId. */
async function rankPassages(
  req: BookRequest,
  deps: RetrievalDeps,
  w: readonly number[],
  knobs: RerankKnobs,
): Promise<Candidates<BookHit>> {
  const { libraryId, bookId } = req;
  const cut = knobs.pool;
  if (req.mode === "keyword") {
    return { items: single(deps.index.searchBookFts(libraryId, bookId, req.query, req.topK), "keyword"), cut };
  }
  const k = poolK(req, deps, knobs.pool);
  const q = await deps.embedder.embedQuery(req.query);
  if (req.mode === "vector") {
    return { items: single(deps.index.searchBook(libraryId, bookId, q, k), "vector"), cut };
  }
  const vec = deps.index.searchBook(libraryId, bookId, q, POOL);
  const kw = deps.index.searchBookFts(libraryId, bookId, req.query, POOL);
  const idOf = (h: BookHit) => h.chunkId;
  return { items: fuse({ vec, kw, idOf, tieOf: (h) => [0, h.chunkId] }, k, w), cut: hybridCut(knobs, vec, kw, idOf) };
}

/** Rank figure captions per mode — the rankBooks/rankPassages mirror, fused on figureId, ties by (bookId, figureId). */
async function rankFigures(
  req: FiguresRequest,
  deps: RetrievalDeps,
  w: readonly number[],
  knobs: RerankKnobs,
): Promise<Candidates<FigureHit>> {
  const { libraryId, bookId, allow } = req;
  const cut = knobs.pool;
  if (req.mode === "keyword") {
    return {
      items: single(deps.index.searchFiguresFts(libraryId, req.query, req.topK, bookId, allow), "keyword"),
      cut,
    };
  }
  const k = poolK(req, deps, knobs.pool);
  const q = await deps.embedder.embedQuery(req.query);
  if (req.mode === "vector") {
    return { items: single(deps.index.searchFigures(libraryId, q, k, bookId, allow), "vector"), cut };
  }
  const vec = deps.index.searchFigures(libraryId, q, POOL, bookId, allow);
  const kw = deps.index.searchFiguresFts(libraryId, req.query, POOL, bookId, allow);
  const idOf = (h: FigureHit) => h.figureId;
  return {
    items: fuse({ vec, kw, idOf, tieOf: (h) => [h.bookId, h.figureId] }, k, w),
    cut: hybridCut(knobs, vec, kw, idOf),
  };
}

/**
 * A fused item on its way into the rerank stage. `keywordAlt` is the keyword half's chunk of the
 * same library book (#604), scored as a second candidate; the source is the field, not a position.
 */
type Pooled<H> = Ranked<H> & { keywordAlt?: H };

/** The rerank stage's outcome: topK results (reordered when it ran) + honesty fields. */
interface RerankOutcome<T> {
  hits: T[];
  reranked: boolean;
  maxRerank?: number;
  note?: string;
}

/**
 * Cross-encoder rerank (D-011): score (query, candidate body) pairs for a prefix of the fused
 * order and emit those items by their best candidate's score; items past the prefix keep their
 * fused order after the reranked head (no rerank score claimed — the latency guard at high topK).
 * The prefix admits items in fused order while their candidates fit in the pair cap (RERANK_POOL
 * unless a #644 knob changed it); the first
 * item that does not fit ends it, so the scored items are always a prefix of the fused order. An
 * item with several candidates (library, #604) keeps the best-scoring one, the first on a tie.
 * Always-on for hybrid/vector when a reranker is wired (CALIBRE_MCP_RERANK=off opts out);
 * keyword mode skips it. Degrades (never fails): errors fall back to the fused order + a note.
 */
async function applyRerank<H>(
  { items: pool, cut }: Candidates<H>,
  req: BaseRequest,
  deps: RetrievalDeps,
  knobs: RerankKnobs,
  // body: the text the cross-encoder scores; tie: (book id, unit id), the ascending order for
  // equal rerank scores (#392) instead of the fused order; tier + weakAfterBody: the matter rules
  keys: {
    body: (h: H) => string;
    tie: (h: H) => readonly [number, number];
    tier: (h: H) => Tier;
    weakAfterBody: boolean;
  },
): Promise<RerankOutcome<Ranked<H>>> {
  // Without a rerank every non-body hit follows the body hits, fused order kept within each (#18);
  // partition before the cut, so a fallback never takes a body hit's place in topK (#605).
  const fused = () => bodyFirst(pool.map(plain), (h) => keys.tier(h) === "body").slice(0, req.topK);
  // Absent reranker = not wired in this deployment/test — silently keep the fused order.
  if (req.mode === "keyword" || pool.length === 0 || !deps.reranker) {
    return { hits: fused(), reranked: false };
  }
  // Env-disabled = a deliberate user choice — same degrade shape, but say why (D-011).
  if (!deps.config.rerankEnabled) {
    return { hits: fused(), reranked: false, note: RERANK_DISABLED_NOTE };
  }
  // Strong kinds take no pair from the cap (#605); the scored items are a prefix of the rest. A
  // pool of only strong items is reranked as usual, so lowConfidence still sees a weak match.
  const notStrong = pool.filter((r) => keys.tier(r.hit) !== "strong");
  const rest = notStrong.length > 0 ? notStrong : pool;
  const strong = notStrong.length > 0 ? pool.filter((r) => keys.tier(r.hit) === "strong").map(plain) : [];
  try {
    const head = admit(rest, cut);
    const passages = head.flatMap((r) => candidatesOf(r).map(keys.body));
    const t0 = performance.now();
    // the third argument only for a #644 truncation arm, so shipped calls stay byte-identical
    const scores =
      knobs.maxTokens === undefined
        ? await deps.reranker.rerank(req.query, passages)
        : await deps.reranker.rerank(req.query, passages, { maxTokens: knobs.maxTokens });
    deps.log.debug("rerank stage", { pairs: passages.length, cut, ms: Math.round(performance.now() - t0) });
    let at = 0;
    const scored = head.map((r) => {
      const main = scores[at] ?? 0;
      const alt = r.keywordAlt ? (scores[at + 1] ?? 0) : undefined;
      at += r.keywordAlt ? 2 : 1;
      // the keyword chunk wins only on a strictly higher score: the vector chunk keeps ties
      const useAlt = alt !== undefined && alt > main;
      const provenance: HitProvenance = {
        ...r.provenance!,
        rerankPool: true,
        ...(useAlt ? { chunkFrom: "keyword" as const } : {}),
        ...(alt !== undefined ? { otherRerankScore: useAlt ? main : alt } : {}),
      };
      return { ...plain(r), hit: useAlt ? r.keywordAlt! : r.hit, rerankScore: useAlt ? alt : main, provenance };
    });
    scored.sort((a, b) => {
      const [ab, au] = keys.tie(a.hit);
      const [bb, bu] = keys.tie(b.hit);
      return b.rerankScore - a.rerankScore || ab - bb || au - bu;
    });
    const tail = rest.slice(head.length).map(plain);
    // Library: weak books follow every body book (reranked or past the cap); book scope keeps them
    // in place. Strong items follow in fused order either way (#605).
    const ordered = keys.weakAfterBody
      ? bodyFirst([...scored, ...tail], (h) => keys.tier(h) === "body")
      : [...scored, ...tail];
    const hits = [...ordered, ...strong].slice(0, req.topK);
    const isBody = keys.weakAfterBody ? (h: H) => keys.tier(h) === "body" : undefined;
    return { hits, reranked: true, maxRerank: maxRerankOf(hits, isBody) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log.warn("rerank skipped", { reason });
    return { hits: fused(), reranked: false, note: reason === "RERANKER_BUSY" ? RERANK_BUSY_NOTE : RERANK_NOTE };
  }
}

/** An item's rerank candidates: its hit, then the keyword half's chunk when it has one. */
function candidatesOf<H>(r: Pooled<H>): H[] {
  return r.keywordAlt ? [r.hit, r.keywordAlt] : [r.hit];
}

/** Stable partition: items whose hit passes `isBody` first, then the rest, order kept in each. */
function bodyFirst<H>(items: Ranked<H>[], isBody: (h: H) => boolean): Ranked<H>[] {
  return [...items.filter((r) => isBody(r.hit)), ...items.filter((r) => !isBody(r.hit))];
}

/** The longest prefix of the fused order whose candidates fit in `cut` pairs (ADR-0011 latency cap). */
function admit<H>(pool: Pooled<H>[], cut: number): Pooled<H>[] {
  const head: Pooled<H>[] = [];
  let pairs = 0;
  for (const r of pool) {
    const n = candidatesOf(r).length;
    if (pairs + n > cut) break; // no skipping ahead: the scored items stay a prefix
    head.push(r);
    pairs += n;
  }
  return head;
}

/** The item without its extra candidate, so it never reaches the hits retrieve() returns. */
function plain<H>({ keywordAlt: _alt, ...r }: Pooled<H>): Ranked<H> {
  return r;
}

/** Drop hits whose book is gone (#579); maxRerank then comes from the hits that are left. */
async function dropGone<T extends { hit: { bookId: number }; rerankScore?: number }>(
  rr: RerankOutcome<T>,
  gone: GoneBooks | undefined,
  isBody?: (h: T["hit"]) => boolean,
): Promise<RerankOutcome<T>> {
  if (!gone || rr.hits.length === 0) return rr;
  const goneIds = await gone(rr.hits.map((r) => r.hit.bookId));
  if (goneIds.size === 0) return rr;
  const hits = rr.hits.filter((r) => !goneIds.has(r.hit.bookId));
  const maxRerank = rr.reranked ? maxRerankOf(hits, isBody) : undefined;
  return {
    hits,
    reranked: rr.reranked,
    ...(rr.note ? { note: rr.note } : {}),
    ...(maxRerank !== undefined ? { maxRerank } : {}),
  };
}

/**
 * Two confidence signals, kept separate (not conflated): the cosine floor judges the COSINE
 * half only; the reranker's sigmoid score is its own calibrated confidence (< RERANK_FLOOR ≈
 * weak). Either signal alone marks the result set low-confidence; both raw maxima are surfaced.
 * `floor` null = no cosine floor (figures, until FIGURES_SEMANTIC_FLOOR is calibrated).
 */
function confidence(ranked: { cosine?: number }[], floor: number | null, rr: RerankOutcome<unknown>) {
  const cosines = ranked.map((r) => r.cosine).filter((c): c is number => c !== undefined);
  const maxScore = cosines.length ? Math.max(...cosines) : undefined;
  const cosineLow = floor !== null && maxScore !== undefined && maxScore < floor;
  const rerankLow = rr.reranked && rr.maxRerank !== undefined && rr.maxRerank < RERANK_FLOOR;
  return { maxScore, lowConfidence: cosineLow || rerankLow };
}
