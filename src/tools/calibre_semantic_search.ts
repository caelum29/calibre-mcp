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
// Ranking/fusion/rerank/confidence live in semantic/retrieve.ts (#259); this file adapts + renders.

import { z } from "zod";
import { type RankedHits, type RetrievalMode, retrieve } from "../semantic/retrieve.js";
import { SNIPPET_CHARS } from "../semantic/snippet.js";
import type { ChunkIndex, FigureIndex, IndexFreshness, LibraryHit } from "../semantic/store/index.js";
import { type FilterResolution, honestyLines, restrictSet, resolveFilter } from "../app/bundles.js";
import { boardMeta } from "./board-meta.js";
import { BookId, CoercedBool, limitParam } from "./coerce.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { resolveNumericId } from "../app/resolve-id.js";
import { INSTALL_TRANSFORMERS } from "./remediation.js";
import { fence, toolError, toolOk, toolErrorFrom } from "./result.js";
import type { ContentBlock, ToolResult } from "./types.js";
import type { BaseDeps, DepsWithIndex } from "./deps.js";
import { errorCodeFor } from "../domain/error-codes.js";

export const semanticSearchTool = defineTool({
  name: "calibre_semantic_search",
  title: "Semantic search",
  description:
    "Meaning-based search over the local index. scope=library ranks books; scope=book (needs bookId) ranks passages within one book. target=figures searches figure captions instead of text — use when the user asks for a diagram/chart/schema; hits point at calibre_get_figures for the pixels. mode=hybrid (default) fuses semantic + keyword matches; mode=vector is semantic-only; mode=keyword is exact keyword/FTS (no model at query time). All modes need an index built by calibre_build_index. filter accepts a bundle name to scope library searches (list bundles via calibre_manage_bundles). Model inference is serialized: prefer one call at a time — parallel calls queue, and past a few the extras skip the rerank.",
  inputSchema: {
    query: z.string().min(1).max(512),
    scope: z.enum(["library", "book"]).default("library"),
    // What corpus is searched (orthogonal to scope, which says WHERE). Open enum by design:
    // a future "code" target over Listing captions is anticipated (D-018 amendment, #83).
    target: z.enum(["text", "figures"]).default("text"),
    mode: z.enum(["hybrid", "vector", "keyword"]).default("hybrid"),
    bookId: BookId().optional(),
    topK: limitParam(50, 10),
    library: z.string().optional(),
    filter: z.string().trim().min(1).max(256).optional(),
    include_excluded: CoercedBool().optional(),
  },
  outputSchema: {
    scope: z.string().optional(),
    target: z.string().optional(),
    mode: z.string().optional(),
    bookId: z.number().optional(),
    count: z.number().optional(),
    maxScore: z.number().optional(),
    lowConfidence: z.boolean().optional(),
    reranked: z.boolean().optional(),
    maxRerank: z.number().optional(),
    // Degradation surfacing (issue #41): false when the index has no vectors, so semantic
    // (vector/hybrid) ranking can't run for this library — with the reason spelled out.
    semanticAvailable: z.boolean().optional(),
    semanticReason: z.string().optional(),
    note: z.string().optional(),
    filter: z.string().optional(),
    exclusionsApplied: z.array(z.string()).optional(),
    bookIds: z.array(z.number()).optional(),
    // Index generation that produced every location in this response (#136) — charStart/
    // charEnd/charOffset/page are valid only within it; clients persisting citations pin to it.
    indexVersion: z.number().optional(),
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
          // Book offset the snippet starts at (#243) — calibre_get_content offset= jumps there.
          snippetStart: z.number().optional(),
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
    // target=figures hits: pointers + caption + linked context chunk, never pixels (#83).
    figures: z
      .array(
        z.object({
          bookId: z.number(),
          title: z.string(),
          authors: z.array(z.string()),
          figIndex: z.number(),
          page: z.number(),
          caption: z.string(),
          format: z.string(),
          source: z.string().optional(),
          cosine: z.number().optional(),
          rerankScore: z.number().optional(),
          charOffset: z.number(),
          contextCharStart: z.number().optional(),
          contextCharEnd: z.number().optional(),
          contextSnippet: z.string().optional(),
        }),
      )
      .optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps: SemanticDeps) => {
    try {
      const libraryId = await deps.content.resolveLibraryId(args.library);

      if (!deps.index.hasIndex(libraryId)) {
        return toolError(
          "index_missing",
          "No semantic index for this library yet. Run calibre_build_index with a bookId, ids, or query first (add keywordOnly=true to build a model-free keyword index).",
        );
      }

      // Provenance for every location below (#136); read from the index's own meta.
      const indexVersion = deps.index.indexMeta(libraryId)?.indexVersion;

      // A keyword-only index (built without the embedding model) has no vectors: vector mode
      // can't run, and hybrid degrades to keyword (degrading beats erroring for the default).
      // Every success carries semanticAvailable (+ reason when false) so an automatic
      // downgrade never reads as an unqualified success (issue #41).
      const sem: SemStatus = deps.index.hasVectors(libraryId)
        ? { semanticAvailable: true }
        : {
            semanticAvailable: false,
            semanticReason:
              "Index is keyword-only (no embeddings) — vector & hybrid semantic ranking unavailable until an embedding rebuild.",
          };
      let mode = args.mode;
      let note: string | undefined;
      if ((mode === "vector" || mode === "hybrid") && !sem.semanticAvailable) {
        if (mode === "vector") {
          return toolError(
            "dependency_missing",
            `This index was built keyword-only (no embeddings), so vector search is unavailable. ${INSTALL_TRANSFORMERS} Then rebuild with calibre_build_index { force: true }, or use mode:"keyword" now (no model needed).`,
          );
        }
        mode = "keyword";
        note = `Index is keyword-only (no embeddings) — showing keyword (FTS) matches. For semantic ranking: ${INSTALL_TRANSFORMERS} Then rebuild with calibre_build_index force=true.`;
      }
      const effArgs: Args = { ...args, mode };

      if (effArgs.scope === "book") {
        // Bundles scope LIBRARY discovery; a named book is already the narrowest scope.
        if (effArgs.filter !== undefined) {
          return toolError(
            "invalid_input",
            "filter (bundle) applies to scope=library only — scope=book already names one book.",
          );
        }
        if (effArgs.bookId === undefined) {
          return toolError("invalid_input", "scope=book requires bookId (the book to search within).");
        }
        const numericId = await resolveNumericId(deps, effArgs.bookId, effArgs.library);
        if (numericId === undefined) return toolError("not_found", `No book with id/uuid ${effArgs.bookId}`);
        if (!deps.index.isBookIndexed(libraryId, numericId)) {
          return toolError(
            "index_missing",
            `Book ${numericId} is not indexed. Run calibre_build_index { bookId: ${numericId} } first.`,
          );
        }
        if (effArgs.target === "figures") {
          return withIndexVersion(await figuresTarget(effArgs, deps, libraryId, numericId, sem, note), indexVersion);
        }
        return withIndexVersion(await bookScope(effArgs, deps, libraryId, numericId, sem, note), indexVersion);
      }

      // Library scope = discovery: resolve the bundle filter + auto exclusion markers (#93).
      // Restriction is query-time only — an allowed-book-id set intersected with the index
      // candidates before exact ranking; the index itself never bakes bundles in (D-019).
      const fr = await resolveFilter(deps, {
        filter: effArgs.filter,
        includeExcluded: effArgs.include_excluded,
        autoExclude: true,
        library: effArgs.library,
      });
      if (!fr.ok) return toolErrorFrom(fr.cause, fr.error);
      const allow = await restrictSet(deps, fr.res, effArgs.library);
      const scope: FilterCtx = { fRes: fr.res, ...(allow ? { allow } : {}) };
      note = joinNotes(note, ...honestyLines(fr.res, allow?.size));

      if (effArgs.target === "figures") {
        return withIndexVersion(
          await figuresTarget(effArgs, deps, libraryId, undefined, sem, note, scope),
          indexVersion,
        );
      }
      return withIndexVersion(await libraryScope(effArgs, deps, libraryId, sem, note, scope), indexVersion);
    } catch (err) {
      return mapError(err);
    }
  },
});

type Mode = RetrievalMode;

type Args = {
  query: string;
  scope: "library" | "book";
  target: "text" | "figures";
  mode: Mode;
  bookId?: number | string;
  topK: number;
  library?: string;
  filter?: string;
  include_excluded?: boolean;
};

/** Resolved bundle scope for a library-scope call (#93): the resolution + allowed id set. */
interface FilterCtx {
  fRes: FilterResolution;
  /** Absent = unscoped call (no filter, no markers) — candidates are unrestricted. */
  allow?: ReadonlySet<number>;
}

/** Neutral scope for paths the filter layer doesn't reach (scope=book). */
const UNSCOPED: FilterCtx = { fRes: { markers: [] } };

/** filter/exclusions mirrored into structuredContent + the board payload. */
function filterFields(scope: FilterCtx): { filter?: string; exclusionsApplied?: string[] } {
  return {
    ...(scope.fRes.bundle ? { filter: scope.fRes.bundle.name } : {}),
    ...(scope.fRes.markers.length > 0 ? { exclusionsApplied: scope.fRes.markers.map((m) => m.name) } : {}),
  };
}

/**
 * The index ports calibre_semantic_search reads (#272): presence/provenance checks plus chunk and
 * figure retrieval — never writes.
 */
export type SemanticIndex = Pick<IndexFreshness, "hasIndex" | "indexMeta" | "hasVectors" | "isBookIndexed"> &
  ChunkIndex &
  FigureIndex;
/** calibre_semantic_search's deps: BaseDeps plus the SemanticIndex port. */
export type SemanticDeps = DepsWithIndex<SemanticIndex>;

/** Semantic-capability verdict for the resolved library's index, spread into every success. */
interface SemStatus {
  semanticAvailable: boolean;
  semanticReason?: string;
}

/** Board payload for a ranked book page (issue #22) — library scope only. */
function semanticBoardMeta(
  deps: BaseDeps,
  args: Args,
  libraryId: string,
  ranked: RankedHits<LibraryHit>["hits"],
  lowConfidence: boolean,
  scope: FilterCtx,
): Record<string, unknown> {
  return boardMeta(deps, "calibre_semantic_search", {
    query: args.query,
    // keyword-degraded runs carry no scores — the widget hides the badge column then
    kind: args.mode === "keyword" ? "keyword" : "semantic",
    libraryId,
    lowConfidence,
    total: ranked.length,
    ...filterFields(scope),
    books: ranked.map((r) => ({
      bookId: r.hit.bookId,
      title: r.hit.title,
      authors: r.hit.authors,
      ...(r.cosine !== undefined || r.rerankScore !== undefined ? { score: r.cosine ?? r.rerankScore } : {}),
    })),
  });
}

/** scope=library — rank books; emit resource_links + fenced snippets. */
async function libraryScope(
  args: Args,
  deps: SemanticDeps,
  libraryId: string,
  sem: SemStatus,
  degradeNote?: string,
  scope: FilterCtx = UNSCOPED,
) {
  const rr = await retrieve(deps, {
    scope: "library",
    libraryId,
    query: args.query,
    mode: args.mode,
    topK: args.topK,
    ...(scope.allow ? { allow: scope.allow } : {}),
  });
  const ranked = rr.hits;
  const note = joinNotes(degradeNote, ...rr.notes);
  if (ranked.length === 0) {
    // Zero results attach no board (issue #68) — an empty shelf adds nothing over the text.
    return toolOk([{ type: "text", text: withNote(`No matches for "${args.query}".`, note) }], {
      scope: "library",
      target: "text",
      mode: args.mode,
      count: 0,
      ...rerankFields(args, rr),
      ...sem,
      note,
      ...filterFields(scope),
      bookIds: [],
    });
  }

  const { maxScore, lowConfidence } = rr;
  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: withNote(
        header("book", ranked.length, args, maxScore, lowConfidence, rr) +
          // snippets are cut around the query terms (#243); say how to read on from one
          " Snippets show the matched part of each chunk; read on via calibre_get_content id=<bookId> offset=<snippet@>.",
        note,
      ),
    },
  ];
  const results: Record<string, unknown>[] = [];
  for (const r of ranked) {
    const link = bookResourceLink({ id: r.hit.bookId, title: r.hit.title, authors: r.hit.authors });
    link.description = [scoreLabel(r), r.hit.authors.join(", ")].filter(Boolean).join(" — ");
    blocks.push(link);
    const at = r.hit.snippetStart !== undefined ? ` snippet@${r.hit.snippetStart}` : "";
    const fenced = fence(`MATCH book ${r.hit.bookId} @${r.hit.charStart}-${r.hit.charEnd}${at}`, r.hit.snippet);
    blocks.push({ type: "text", text: fenced });
    results.push({
      bookId: r.hit.bookId,
      title: r.hit.title,
      authors: r.hit.authors,
      ...(r.cosine !== undefined ? { cosine: r.cosine } : {}),
      ...(r.rerankScore !== undefined ? { rerankScore: r.rerankScore } : {}),
      charStart: r.hit.charStart,
      charEnd: r.hit.charEnd,
      ...(r.hit.snippetStart !== undefined ? { snippetStart: r.hit.snippetStart } : {}),
      snippet: fenced,
    });
  }

  return {
    ...toolOk(blocks, {
      scope: "library",
      target: "text",
      mode: args.mode,
      count: ranked.length,
      maxScore,
      lowConfidence,
      ...rerankFields(args, rr),
      ...sem,
      note,
      ...filterFields(scope),
      bookIds: ranked.map((r) => r.hit.bookId),
      results,
    }),
    _meta: semanticBoardMeta(deps, args, libraryId, ranked, lowConfidence, scope),
  };
}

/** scope=book — rank passages within one book; emit fenced excerpts with char spans. */
async function bookScope(
  args: Args,
  deps: SemanticDeps,
  libraryId: string,
  bookId: number,
  sem: SemStatus,
  degradeNote?: string,
) {
  // retrieve() also applies the front-matter demotion (#18) and reports it in notes.
  const rr = await retrieve(deps, {
    scope: "book",
    libraryId,
    bookId,
    query: args.query,
    mode: args.mode,
    topK: args.topK,
  });
  const ranked = rr.hits;
  const note = joinNotes(degradeNote, ...rr.notes);
  if (ranked.length === 0) {
    return toolOk([{ type: "text", text: withNote(`No passages in book ${bookId} matched "${args.query}".`, note) }], {
      scope: "book",
      target: "text",
      mode: args.mode,
      bookId,
      count: 0,
      ...rerankFields(args, rr),
      ...sem,
      note,
    });
  }

  const { maxScore, lowConfidence } = rr;
  const head = withNote(
    header("passage", ranked.length, args, maxScore, lowConfidence, rr) +
      // name the book: text-only clients need the id to follow up (#234)
      ` Re-read any passage via calibre_get_content id=${bookId} (pass its start char as offset).`,
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
    ...sem,
    note,
    passages,
  });
}

/**
 * target=figures (#83/D-018): rank figure captions — library-wide or within one book —
 * through the mirrored hybrid pipeline (caption FTS5 + vector + RRF + rerank on the short
 * (query, caption) pairs). Hits are pointers + caption + the offset-linked context chunk +
 * calibre_get_figures steering — never pixels (list-then-fetch).
 */
async function figuresTarget(
  args: Args,
  deps: SemanticDeps,
  libraryId: string,
  bookId: number | undefined,
  sem: SemStatus,
  degradeNote?: string,
  scope: FilterCtx = UNSCOPED,
) {
  const scopeWord = bookId === undefined ? "library" : `book ${bookId}`;
  const indexed = deps.index.figureCount(libraryId, bookId);
  if (indexed === 0) {
    // Honest-empty (D-018): could be a genuinely figure-less corpus (scanned PDFs, Packt
    // unnumbered captions) OR an index built before figure support — say both, steer both.
    return toolOk(
      [
        {
          type: "text",
          text: withNote(
            `0 figure captions are indexed for this ${scopeWord}. Either the indexed books have no captioned figures, or they were indexed before figure support — re-run calibre_build_index with force:true to index captions. calibre_get_figures mode:"list" shows a book's live figure inventory without the index.`,
            degradeNote,
          ),
        },
      ],
      {
        scope: args.scope,
        target: "figures",
        mode: args.mode,
        count: 0,
        ...sem,
        note: degradeNote,
        ...filterFields(scope),
      },
    );
  }

  const rr = await retrieve(deps, {
    scope: "figures",
    libraryId,
    query: args.query,
    mode: args.mode,
    topK: args.topK,
    ...(bookId !== undefined ? { bookId } : {}),
    ...(scope.allow ? { allow: scope.allow } : {}),
  });
  const ranked = rr.hits;
  const note = joinNotes(degradeNote, ...rr.notes);
  if (ranked.length === 0) {
    return toolOk(
      [{ type: "text", text: withNote(`No figure captions in this ${scopeWord} matched "${args.query}".`, note) }],
      {
        scope: args.scope,
        target: "figures",
        mode: args.mode,
        ...(bookId !== undefined ? { bookId } : {}),
        count: 0,
        ...rerankFields(args, rr),
        ...sem,
        note,
        ...filterFields(scope),
        figures: [],
      },
    );
  }

  const { maxScore, lowConfidence } = rr;
  const head = withNote(
    header("figure", ranked.length, args, maxScore, lowConfidence, rr) +
      ` Fetch pixels via calibre_get_figures { bookId, indexes: [figIndex] }.` +
      (ranked.some((r) => r.hit.format !== "pdf")
        ? ` ~p.N on EPUB hits = approximate page (spine-document ordinal, as in the calibre_get_figures listing).`
        : ""),
    note,
  );
  const blocks: ContentBlock[] = [{ type: "text", text: head }];
  const figures: Record<string, unknown>[] = [];
  for (const r of ranked) {
    const h = r.hit;
    const ctx = deps.index.chunkAt(libraryId, h.bookId, h.charOffset);
    const snippet = ctx ? ctx.body.slice(0, SNIPPET_CHARS) : undefined;
    // EPUB "page" is the spine-document ordinal — same number the get_figures listing shows,
    // flagged approximate (#105).
    const pagePart = h.format === "pdf" ? `p.${h.page},` : `~p.${h.page},`;
    const srcPart = h.source ? ` ${h.source},` : "";
    const fenced = fence(
      `FIGURE book ${h.bookId} #${h.figIndex} (${pagePart}${srcPart} @${h.charOffset}) ${scoreLabel(r)}`,
      h.caption + (snippet ? `\n--- context @${ctx!.charStart}-${ctx!.charEnd} ---\n${snippet}` : ""),
    );
    blocks.push({
      type: "text",
      text: `Figure #${h.figIndex} in "${h.title}" (book ${h.bookId}) — fetch: calibre_get_figures { bookId: ${h.bookId}, indexes: [${h.figIndex}] }\n${fenced}`,
    });
    figures.push({
      bookId: h.bookId,
      title: h.title,
      authors: h.authors,
      figIndex: h.figIndex,
      page: h.page,
      caption: h.caption,
      format: h.format,
      ...(h.source !== undefined ? { source: h.source } : {}),
      ...(r.cosine !== undefined ? { cosine: r.cosine } : {}),
      ...(r.rerankScore !== undefined ? { rerankScore: r.rerankScore } : {}),
      charOffset: h.charOffset,
      ...(ctx ? { contextCharStart: ctx.charStart, contextCharEnd: ctx.charEnd } : {}),
      ...(snippet !== undefined ? { contextSnippet: snippet } : {}),
    });
  }

  // No cover-board _meta here: the board renders BOOK results; figure hits have no board shape.
  return toolOk(blocks, {
    scope: args.scope,
    target: "figures",
    mode: args.mode,
    ...(bookId !== undefined ? { bookId } : {}),
    count: ranked.length,
    maxScore,
    lowConfidence,
    ...rerankFields(args, rr),
    ...sem,
    note,
    ...filterFields(scope),
    figures,
  });
}

/**
 * Stamp a success with its index generation (#136): once on the envelope, never per hit (it's
 * constant across the response), and as one compact line after the header — the text must
 * carry it too because clients strip structuredContent.
 */
function withIndexVersion(res: ToolResult, indexVersion: number | undefined): ToolResult {
  if (res.isError || indexVersion === undefined) return res;
  const [first, ...rest] = res.content;
  const line = `indexVersion ${indexVersion} — char offsets/pages here are valid within this index generation only.`;
  const content: ContentBlock[] =
    first?.type === "text"
      ? [{ ...first, text: `${first.text}\n${line}` }, ...rest]
      : [{ type: "text", text: line }, ...res.content];
  return { ...res, content, structuredContent: { ...res.structuredContent, indexVersion } };
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

/** `reranked`/`maxRerank` are only claims for modes where reranking applies (hybrid/vector). */
function rerankFields(args: Args, rr: RankedHits<unknown>): Record<string, unknown> {
  if (args.mode === "keyword") return {};
  return { reranked: rr.reranked, ...(rr.maxRerank !== undefined ? { maxRerank: rr.maxRerank } : {}) };
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
  rr?: RankedHits<unknown>,
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
      "dependency_missing",
      `Semantic (vector/hybrid) search needs the embedding model. ${INSTALL_TRANSFORMERS} Or search now without it: build a keyword-only index (calibre_build_index keywordOnly=true) and use mode:"keyword".`,
    );
  }
  if (m.startsWith("INDEX_INCOMPATIBLE")) {
    return toolError("index_incompatible", m.replace(/^INDEX_INCOMPATIBLE:\s*/, ""));
  }
  return toolError(errorCodeFor(err), m);
}
