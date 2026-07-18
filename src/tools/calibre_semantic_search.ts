// calibre_semantic_search — meaning-based retrieval over the local index (the project's
// headline differentiator). Two scopes and three modes, one tool (no extra surface, DESIGN §2):
//   scope=library : rank BOOKS by their best-matching passage → resource_links + scores
//   scope=book    : rank PASSAGES within one book → fenced excerpts with char locations
//   mode=hybrid   : RRF-fuse the vector (cosine) and keyword (FTS5 bm25) halves — the default,
//     best recall; mode=vector = semantic only; mode=keyword = FTS only (no model at query
//     time — but still needs an index; a keyword-only build serves it with zero ML deps).
// Requires an index built by calibre_build_index; returns an actionable error otherwise.
// A keyword-only index has no vectors: mode=vector errors, mode=hybrid degrades to keyword.
// Snippets are untrusted book text → fenced. Cosine below config.semanticFloor → low-confidence.
// Ranked hits are ALSO mirrored into structuredContent (results/passages) so structured-only
// clients that drop text content blocks still surface them; the mirrored text keeps the fence.
// hybrid/vector results pass through a cross-encoder rerank stage (D-011) when the optional
// reranker model is available; keyword mode has no semantic claim to sharpen and skips it.

import { z } from "zod";
import { RRF_K, rrfFuse } from "../semantic/fusion.js";
import { RERANK_FLOOR, RERANK_POOL } from "../semantic/reranker.js";
import { stemText } from "../semantic/stem.js";
import type { BookHit, LibraryHit } from "../semantic/store.js";
import type { BoardPayload } from "../ui/board-cache.js";
import { BookId, limitParam } from "./coerce.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { resolveNumericId } from "./resolve-id.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ContentBlock, ToolDeps } from "./types.js";

/** Per-half candidate pool the fuser draws from (design: vector top-50 + keyword top-50). */
const POOL = 50;

// Weighted-RRF per-source weights for hybrid fusion (fusion literature: per-source weight is
// the impactful knob, more than k). Both 1.0 = plain RRF; no config/env surface — change them
// ONLY on retrieval-eval evidence (test/eval/retrieval), never by feel.
const VECTOR_RRF_WEIGHT = 1.0;
const KEYWORD_RRF_WEIGHT = 1.0;
const RRF_WEIGHTS = [VECTOR_RRF_WEIGHT, KEYWORD_RRF_WEIGHT];

type Mode = "hybrid" | "vector" | "keyword";

export const semanticSearchTool = defineTool({
  name: "calibre_semantic_search",
  title: "Semantic search",
  description:
    "Meaning-based search over the local index. scope=library ranks books; scope=book (needs bookId) ranks passages within one book. mode=hybrid (default) fuses semantic + keyword matches; mode=vector is semantic-only; mode=keyword is exact keyword/FTS over an already-built index (no model at query time). All modes need an index built by calibre_build_index (keyword mode works even with a keyword-only, model-free index).",
  inputSchema: {
    query: z.string().min(1).max(512),
    scope: z.enum(["library", "book"]).default("library"),
    mode: z.enum(["hybrid", "vector", "keyword"]).default("hybrid"),
    bookId: BookId().optional(),
    topK: limitParam(50, 10),
    library: z.string().optional(),
  },
  outputSchema: {
    scope: z.string().optional(),
    mode: z.string().optional(),
    bookId: z.number().optional(),
    count: z.number().optional(),
    maxScore: z.number().optional(),
    lowConfidence: z.boolean().optional(),
    reranked: z.boolean().optional(),
    maxRerank: z.number().optional(),
    note: z.string().optional(),
    bookIds: z.array(z.number()).optional(),
    // Ranked hits mirrored into structuredContent so structured-only clients (that render
    // structuredContent but drop text content blocks) still surface the snippets/passages.
    // scope=library → results (one per book); scope=book → passages (one per chunk). Free
    // text is fenced (untrusted-book-text invariant) and kept identical to the text blocks.
    results: z
      .array(
        z.object({
          bookId: z.number(),
          title: z.string(),
          authors: z.array(z.string()),
          cosine: z.number().optional(),
          rerankScore: z.number().optional(),
          charStart: z.number(),
          charEnd: z.number(),
          snippet: z.string(),
        }),
      )
      .optional(),
    passages: z
      .array(
        z.object({
          charStart: z.number(),
          charEnd: z.number(),
          cosine: z.number().optional(),
          rerankScore: z.number().optional(),
          frontMatter: z.boolean().optional(),
          body: z.string(),
        }),
      )
      .optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) => {
    try {
      const libraryId = await deps.content.resolveLibraryId(args.library);

      if (!deps.index.hasIndex(libraryId)) {
        return toolError(
          "No semantic index for this library yet. Run calibre_build_index with a bookId, ids, or query first (add keywordOnly=true to build a model-free keyword index).",
        );
      }

      // A keyword-only index (built without the embedding model) has no vectors: vector mode
      // can't run, and hybrid degrades to keyword (degrading beats erroring for the default).
      let mode = args.mode;
      let note: string | undefined;
      if ((mode === "vector" || mode === "hybrid") && !deps.index.hasVectors(libraryId)) {
        if (mode === "vector") {
          return toolError(
            'This index was built keyword-only (no embeddings), so vector search is unavailable. Rebuild with the model — install @huggingface/transformers, then calibre_build_index { force: true } — or use mode:"keyword".',
          );
        }
        mode = "keyword";
        note =
          "Index built keyword-only (no embeddings) — showing keyword (FTS) matches. Rebuild with the model (calibre_build_index force=true) for semantic ranking.";
      }
      const effArgs: Args = { ...args, mode };

      if (effArgs.scope === "book") {
        if (effArgs.bookId === undefined) {
          return toolError("scope=book requires bookId (the book to search within).");
        }
        const numericId = await resolveNumericId(deps, effArgs.bookId, effArgs.library);
        if (numericId === undefined) return toolError(`No book with id/uuid ${effArgs.bookId}`);
        if (!deps.index.isBookIndexed(libraryId, numericId)) {
          return toolError(
            `Book ${numericId} is not indexed. Run calibre_build_index { bookId: ${numericId} } first.`,
          );
        }
        return await bookScope(effArgs, deps, libraryId, numericId, note);
      }

      return await libraryScope(effArgs, deps, libraryId, note);
    } catch (err) {
      return mapError(err);
    }
  },
});

type Args = {
  query: string;
  scope: "library" | "book";
  mode: Mode;
  bookId?: number | string;
  topK: number;
  library?: string;
};

/** A book result plus its cosine, when the vector half contributed it (absent for keyword-only). */
interface RankedBook {
  hit: LibraryHit;
  cosine?: number;
  /** Cross-encoder sigmoid score, set when the rerank stage reordered this result. */
  rerankScore?: number;
}
/** A passage result plus its cosine, when the vector half contributed it. */
interface RankedPassage {
  hit: BookHit;
  cosine?: number;
  /** Cross-encoder sigmoid score, set when the rerank stage reordered this result. */
  rerankScore?: number;
}

/**
 * Feed the cover-board widget (issue #22): cache the ranked page for the widget's
 * re-pull (Desktop strips the tool-result notification) and return the `_meta` to
 * attach for spec hosts that forward it. Library scope only.
 */
function boardMeta(
  deps: ToolDeps,
  args: Args,
  libraryId: string,
  ranked: RankedBook[],
  lowConfidence: boolean,
): Record<string, unknown> {
  const payload: BoardPayload = {
    tool: "calibre_semantic_search",
    query: args.query,
    // keyword-degraded runs carry no scores — the widget hides the badge column then
    kind: args.mode === "keyword" ? "keyword" : "semantic",
    libraryId,
    serverUrl: deps.config.serverUrl,
    lowConfidence,
    total: ranked.length,
    books: ranked.map((r) => ({
      bookId: r.hit.bookId,
      title: r.hit.title,
      authors: r.hit.authors,
      ...(r.cosine !== undefined || r.rerankScore !== undefined
        ? { score: r.cosine ?? r.rerankScore }
        : {}),
    })),
  };
  deps.boardCache?.set(payload);
  return { calibreBoard: payload };
}

/** scope=library — rank books; emit resource_links + fenced snippets. */
async function libraryScope(args: Args, deps: ToolDeps, libraryId: string, degradeNote?: string) {
  const pool = await rankBooks(args, deps, libraryId);
  const rr = await applyRerank(pool, (r) => r.hit.body, args, deps);
  const ranked = rr.hits;
  const note = joinNotes(degradeNote, rr.note);
  if (ranked.length === 0) {
    return {
      ...toolOk([{ type: "text", text: withNote(`No matches for "${args.query}".`, note) }], {
        scope: "library",
        mode: args.mode,
        count: 0,
        ...rerankFields(args, rr),
        note,
        bookIds: [],
      }),
      _meta: boardMeta(deps, args, libraryId, [], false),
    };
  }

  const { maxScore, lowConfidence } = confidence(ranked, deps, rr);
  const blocks: ContentBlock[] = [
    { type: "text", text: withNote(header("book", ranked.length, args, maxScore, lowConfidence, rr), note) },
  ];
  const results: Record<string, unknown>[] = [];
  for (const r of ranked) {
    const link = bookResourceLink({ id: r.hit.bookId, title: r.hit.title, authors: r.hit.authors });
    link.description = [scoreLabel(r), r.hit.authors.join(", ")].filter(Boolean).join(" — ");
    blocks.push(link);
    const fenced = fence(`MATCH book ${r.hit.bookId} @${r.hit.charStart}-${r.hit.charEnd}`, r.hit.snippet);
    blocks.push({ type: "text", text: fenced });
    results.push({
      bookId: r.hit.bookId,
      title: r.hit.title,
      authors: r.hit.authors,
      ...(r.cosine !== undefined ? { cosine: r.cosine } : {}),
      ...(r.rerankScore !== undefined ? { rerankScore: r.rerankScore } : {}),
      charStart: r.hit.charStart,
      charEnd: r.hit.charEnd,
      snippet: fenced,
    });
  }

  return {
    ...toolOk(blocks, {
      scope: "library",
      mode: args.mode,
      count: ranked.length,
      maxScore,
      lowConfidence,
      ...rerankFields(args, rr),
      note,
      bookIds: ranked.map((r) => r.hit.bookId),
      results,
    }),
    _meta: boardMeta(deps, args, libraryId, ranked, lowConfidence),
  };
}

/** scope=book — rank passages within one book; emit fenced excerpts with char spans. */
async function bookScope(args: Args, deps: ToolDeps, libraryId: string, bookId: number, degradeNote?: string) {
  const pool = await rankPassages(args, deps, libraryId, bookId);
  const rr = await applyRerank(pool, (r) => r.hit.body, args, deps);
  // Front-matter demotion (issue #18): TOC/praise/foreword chunks are keyword-dense but
  // semantically empty, so they win exactly the definitional queries where body content is
  // wanted. Stable-partition AFTER the rerank — body passages first, front matter after,
  // internal order preserved; nothing is dropped ("what does the foreword say" still works).
  const demoted = rr.hits.filter((r) => r.hit.frontMatter).length;
  const ranked = demoted > 0 ? [...rr.hits.filter((r) => !r.hit.frontMatter), ...rr.hits.filter((r) => r.hit.frontMatter)] : rr.hits;
  const note = joinNotes(
    degradeNote,
    rr.note,
    demoted > 0
      ? `${demoted} front-matter passage(s) (TOC/praise/foreword) demoted below body matches.`
      : undefined,
  );
  if (ranked.length === 0) {
    return toolOk(
      [{ type: "text", text: withNote(`No passages in book ${bookId} matched "${args.query}".`, note) }],
      {
        scope: "book",
        mode: args.mode,
        bookId,
        count: 0,
        ...rerankFields(args, rr),
        note,
      },
    );
  }

  const { maxScore, lowConfidence } = confidence(ranked, deps, rr);
  const head = withNote(
    header("passage", ranked.length, args, maxScore, lowConfidence, rr) +
      ` Re-read any passage via calibre_get_content (cursor at its char offset).`,
    note,
  );

  const blocks: ContentBlock[] = [{ type: "text", text: head }];
  const passages: Record<string, unknown>[] = [];
  for (const r of ranked) {
    const fm = r.hit.frontMatter ? " [front matter]" : "";
    const fenced = fence(`PASSAGE @${r.hit.charStart}-${r.hit.charEnd}${fm} ${scoreLabel(r)}`, r.hit.body);
    blocks.push({ type: "text", text: fenced });
    passages.push({
      charStart: r.hit.charStart,
      charEnd: r.hit.charEnd,
      ...(r.cosine !== undefined ? { cosine: r.cosine } : {}),
      ...(r.rerankScore !== undefined ? { rerankScore: r.rerankScore } : {}),
      ...(r.hit.frontMatter ? { frontMatter: true } : {}),
      body: fenced,
    });
  }

  return toolOk(blocks, {
    scope: "book",
    mode: args.mode,
    bookId,
    count: ranked.length,
    maxScore,
    lowConfidence,
    ...rerankFields(args, rr),
    note,
    passages,
  });
}

/** Prepend a degrade/advisory note to a header block (kept in the text so all clients see it). */
function withNote(text: string, note?: string): string {
  return note ? `${note}\n${text}` : text;
}

/** Fold the mode-degrade and rerank-degrade notes into one advisory string. */
function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const kept = notes.filter((n): n is string => Boolean(n));
  return kept.length ? kept.join("\n") : undefined;
}

/** Candidates to materialize: a rerank-sized pool when the reranker can reorder, else topK. */
function poolK(args: Args, deps: ToolDeps): number {
  return rerankActive(args, deps) ? Math.max(args.topK, RERANK_POOL) : args.topK;
}

/** True when the rerank stage will run: a reranker is wired, not env-disabled, mode has a semantic claim. */
function rerankActive(args: Args, deps: ToolDeps): boolean {
  return Boolean(deps.reranker) && deps.config.rerankEnabled && args.mode !== "keyword";
}

/** The rerank stage's outcome: topK results (reordered when it ran) + honesty fields. */
interface RerankOutcome<T> {
  hits: T[];
  reranked: boolean;
  maxRerank?: number;
  note?: string;
}

const RERANK_NOTE =
  "Reranker unavailable — results keep the fused (pre-rerank) order. The cross-encoder model " +
  "downloads on first use; ensure @huggingface/transformers is installed and the machine is online.";

const RERANK_DISABLED_NOTE =
  "Reranking disabled via CALIBRE_MCP_RERANK — results keep the fused (pre-rerank) order.";

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
  args: Args,
  deps: ToolDeps,
): Promise<RerankOutcome<T>> {
  const fused = () => pool.slice(0, args.topK);
  // Absent reranker = not wired in this deployment/test — silently keep the fused order.
  if (args.mode === "keyword" || pool.length === 0 || !deps.reranker) {
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
      args.query,
      head.map((r) => bodyOf(r)),
    );
    deps.log.debug("rerank stage", { pairs: head.length, ms: Math.round(performance.now() - t0) });
    const scored = head.map((r, i) => ({ ...r, rerankScore: scores[i] ?? 0 }));
    scored.sort((a, b) => b.rerankScore - a.rerankScore); // stable: ties keep fused order
    const hits = [...scored, ...pool.slice(RERANK_POOL)].slice(0, args.topK);
    return { hits, reranked: true, maxRerank: scored[0]?.rerankScore };
  } catch (err) {
    deps.log.warn("rerank skipped", { reason: err instanceof Error ? err.message : String(err) });
    return { hits: fused(), reranked: false, note: RERANK_NOTE };
  }
}

/** `reranked`/`maxRerank` are only claims for modes where reranking applies (hybrid/vector). */
function rerankFields(args: Args, rr: RerankOutcome<unknown>): Record<string, unknown> {
  if (args.mode === "keyword") return {};
  return { reranked: rr.reranked, ...(rr.maxRerank !== undefined ? { maxRerank: rr.maxRerank } : {}) };
}

/** Rank books per mode. hybrid RRF-fuses the two halves; vector/keyword use one half each. */
async function rankBooks(args: Args, deps: ToolDeps, libraryId: string): Promise<RankedBook[]> {
  if (args.mode === "keyword") {
    return deps.index
      .searchLibraryFts(libraryId, stemText(args.query), args.topK)
      .map((hit) => ({ hit }));
  }
  const k = poolK(args, deps);
  const q = await deps.embedder.embedQuery(args.query);
  if (args.mode === "vector") {
    return deps.index.searchLibrary(libraryId, q, k).map((hit) => ({ hit, cosine: hit.score }));
  }
  // hybrid: fuse book rankings from both halves by bookId (vector first — RRF_WEIGHTS order).
  const vec = deps.index.searchLibrary(libraryId, q, POOL);
  const kw = deps.index.searchLibraryFts(libraryId, stemText(args.query), POOL);
  const vById = new Map(vec.map((h) => [h.bookId, h]));
  const kById = new Map(kw.map((h) => [h.bookId, h]));
  return rrfFuse([vec.map((h) => h.bookId), kw.map((h) => h.bookId)], RRF_K, RRF_WEIGHTS)
    .slice(0, k)
    .map((f) => {
      const v = vById.get(f.id);
      return { hit: (v ?? kById.get(f.id))!, cosine: v?.score };
    });
}

/** Rank passages within one book per mode, mirroring rankBooks but fusing on chunkId. */
async function rankPassages(
  args: Args,
  deps: ToolDeps,
  libraryId: string,
  bookId: number,
): Promise<RankedPassage[]> {
  if (args.mode === "keyword") {
    return deps.index
      .searchBookFts(libraryId, bookId, stemText(args.query), args.topK)
      .map((hit) => ({ hit }));
  }
  const k = poolK(args, deps);
  const q = await deps.embedder.embedQuery(args.query);
  if (args.mode === "vector") {
    return deps.index.searchBook(libraryId, bookId, q, k).map((hit) => ({ hit, cosine: hit.score }));
  }
  const vec = deps.index.searchBook(libraryId, bookId, q, POOL);
  const kw = deps.index.searchBookFts(libraryId, bookId, stemText(args.query), POOL);
  const vById = new Map(vec.map((h) => [h.chunkId, h]));
  const kById = new Map(kw.map((h) => [h.chunkId, h]));
  return rrfFuse([vec.map((h) => h.chunkId), kw.map((h) => h.chunkId)], RRF_K, RRF_WEIGHTS)
    .slice(0, k)
    .map((f) => {
      const v = vById.get(f.id);
      return { hit: (v ?? kById.get(f.id))!, cosine: v?.score };
    });
}

/**
 * Two confidence signals, kept separate (not conflated): the cosine floor judges the COSINE
 * half only; the reranker's sigmoid score is its own calibrated confidence (< RERANK_FLOOR ≈
 * weak). Either signal alone marks the result set low-confidence; both raw maxima are surfaced.
 */
function confidence(ranked: Array<{ cosine?: number }>, deps: ToolDeps, rr?: RerankOutcome<unknown>) {
  const cosines = ranked.map((r) => r.cosine).filter((c): c is number => c !== undefined);
  const maxScore = cosines.length ? Math.max(...cosines) : undefined;
  const cosineLow = maxScore !== undefined && maxScore < deps.config.semanticFloor;
  const rerankLow = rr?.reranked === true && rr.maxRerank !== undefined && rr.maxRerank < RERANK_FLOOR;
  return { maxScore, lowConfidence: cosineLow || rerankLow };
}

/** Per-result score label: reranker score first (the emitted order), raw cosine kept alongside. */
function scoreLabel(r: { cosine?: number; rerankScore?: number }): string {
  const base = r.cosine !== undefined ? `cosine ${r.cosine.toFixed(3)}` : "keyword match";
  return r.rerankScore !== undefined ? `rerank ${r.rerankScore.toFixed(3)} (${base})` : base;
}

function header(
  unit: string,
  n: number,
  args: Args,
  maxScore: number | undefined,
  lowConfidence: boolean,
  rr?: RerankOutcome<unknown>,
): string {
  const mode = rr?.reranked ? `${args.mode}+rerank` : args.mode;
  const scores: string[] = [];
  if (maxScore !== undefined) scores.push(`max cosine ${maxScore.toFixed(3)}`);
  if (rr?.reranked && rr.maxRerank !== undefined) scores.push(`max rerank ${rr.maxRerank.toFixed(3)}`);
  return (
    `Top ${n} ${unit}(s) for "${args.query}" [${mode}]` +
    (scores.length ? ` (${scores.join(", ")})` : "") +
    (lowConfidence ? " — low confidence, treat as weak matches." : "")
  );
}

/** Map subsystem errors to LLM-actionable messages (mirrors calibre_get_content). */
function mapError(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "EMBEDDER_UNAVAILABLE") {
    return toolError(
      'Semantic (vector/hybrid) search needs the embedding model. Install it (pnpm add @huggingface/transformers), or build a keyword-only index (calibre_build_index keywordOnly=true) and search with mode:"keyword" — which needs no model.',
    );
  }
  if (m.startsWith("INDEX_INCOMPATIBLE")) {
    return toolError(m.replace(/^INDEX_INCOMPATIBLE:\s*/, ""));
  }
  return toolError(m);
}
