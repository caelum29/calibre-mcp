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

import { filterErrorText } from "./writes-remedy.js";
import { z } from "zod";
import { type HitProvenance, type RankedHits, type RetrievalMode, retrieve } from "../semantic/retrieve.js";
import { SNIPPET_CHARS } from "../semantic/snippet.js";
import type {
  ChunkIndex,
  FigureIndex,
  IndexFreshness,
  IndexWriter,
  KeywordPlanReport,
  LibraryHit,
  SectionIndex,
} from "../semantic/store/index.js";
import { findGoneBookIds } from "../app/live-hits.js";
import { type FilterResolution, honestyLines, restrictSet, resolveFilter } from "../app/bundles.js";
import { boardMeta } from "./board-meta.js";
import { BookId, CoercedBool, limitParam, OptionalFilter } from "./coerce.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { resolveNumericId } from "../app/resolve-id.js";
import { INSTALL_TRANSFORMERS } from "./remediation.js";
import { embedderUsable } from "../semantic/status.js";
import { fence, toolError, toolOk, toolErrorFrom } from "./result.js";
import { TimingRecorder, timingsLine } from "./search-timings.js";

// the message's own step doubles as the hint, so the error text states it once (#437)
const SHORT_QUERY_NOTE =
  'Very short query: semantic ranking has little to go on. For an exact term use mode:"keyword"; for a topic, give a longer query.';
const BUILD_LIBRARY_INDEX = "Run calibre_build_index with a bookId, ids, or query first";
import type { ContentBlock, ToolResult } from "./types.js";
import type { BaseDeps, DepsWithIndex } from "./deps.js";
import { errorCodeFor } from "../domain/error-codes.js";
import { figureLocation, figureLocationLabel } from "../domain/figures/location.js";
import { type MatterKind, NON_BODY_KINDS } from "../domain/structure/matter-kind.js";
import { hitLabels, labelLines, SectionPathSchema, TextPageSchema } from "./hit-labels.js";

// Debug-level ranking provenance per hit (#650), the same shape for every scope.
// Front/back matter of a hit (#605); the closed set of stored kinds minus body, which is never sent.
const MatterKindSchema = z.enum(NON_BODY_KINDS);

// The text label for a non-body hit, in the match/passage line (#605); "" for body.
const MATTER_LABEL: Record<MatterKind, string> = {
  body: "",
  front: " [front matter]",
  back_index: " [back matter: index]",
  back_biblio: " [back matter: bibliography]",
  back_other: " [back matter: copyright/ads]",
};

/** The label for a hit's matter kind (absent = body). */
function matterLabel(kind: MatterKind | undefined): string {
  return MATTER_LABEL[kind ?? "body"];
}

/** The structuredContent field for a hit's matter kind: absent for body (#605). */
function matterField(kind: MatterKind | undefined): { matterKind?: Exclude<MatterKind, "body"> } {
  return kind === undefined || kind === "body" ? {} : { matterKind: kind };
}

const ProvenanceSchema = z
  .object({
    vectorRank: z.number().optional(),
    keywordRank: z.number().optional(),
    fusedRank: z.number().optional(),
    rerankPool: z.boolean(),
    chunkFrom: z.enum(["vector", "keyword", "both"]).optional(),
    otherRerankScore: z.number().optional(),
  })
  .optional()
  .describe(
    "Only at CALIBRE_MCP_LOG_LEVEL=debug: 1-based vector/keyword half ranks, fused rank (hybrid), whether the cross-encoder scored the hit, and for library books which half's chunk is shown.",
  );

export const semanticSearchTool = defineTool({
  name: "calibre_semantic_search",
  title: "Semantic search",
  description:
    "Meaning-based search for `query` over the local index. scope=library ranks books; scope=book (needs bookId) ranks passages within one book. target=figures searches figure captions instead of text — use when the user asks for a diagram/chart/schema; hits point at calibre_get_figures for the pixels. mode=hybrid (default) fuses semantic + keyword matches; mode=vector is semantic-only; mode=keyword is exact keyword/FTS (no model at query time). All modes need an index built by calibre_build_index. filter accepts a bundle name to scope library searches (list bundles via calibre_manage_bundles). Model inference is serialized: prefer one call at a time — parallel calls queue, and past a few the extras skip the rerank.",
  inputSchema: {
    query: z.string().max(512),
    scope: z.enum(["library", "book"]).default("library"),
    // What corpus is searched (orthogonal to scope, which says WHERE). Open enum by design:
    // a future "code" target over Listing captions is anticipated (D-018 amendment, #83).
    target: z.enum(["text", "figures"]).default("text"),
    mode: z.enum(["hybrid", "vector", "keyword"]).default("hybrid"),
    bookId: BookId().optional(),
    topK: limitParam(50, 10),
    library: z.string().optional(),
    filter: OptionalFilter(),
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
    // per-stage wall times, only at CALIBRE_MCP_LOG_LEVEL=debug
    timings: z.record(z.string(), z.number()).optional(),
    // what the keyword half's plan left out of the MATCH (#651), only at debug level
    dropped: z
      .array(z.object({ term: z.string(), reason: z.enum(["duplicate", "too-common"]) }))
      .optional()
      .describe(
        "Only at CALIBRE_MCP_LOG_LEVEL=debug, when a text keyword half ran: query terms the keyword MATCH left out: stems in query order — repeated ones (duplicate) and those in more than half of the library's chunks (too-common) — then any identifier (e.g. `is-a`) whose every stem was too common. Absent when the library has no term statistics.",
      ),
    // Degradation surfacing (issue #41): false when the index has no vectors, so semantic
    // (vector/hybrid) ranking can't run for this library — with the reason spelled out.
    semanticAvailable: z
      .boolean()
      .optional()
      .describe(
        "Can vector & hybrid ranking run on this library's index? false when the index is keyword-only (no embeddings); semanticReason and the note say whether a rebuild or a model install is the fix.",
      ),
    semanticReason: z.string().optional(),
    note: z.string().optional(),
    filter: z.string().optional(),
    exclusionsApplied: z.array(z.string()).optional(),
    exclusionsRemoved: z.number().optional(),
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
          // #605: front/back matter of the shown chunk; absent for body text
          matterKind: MatterKindSchema.optional(),
          sectionPath: SectionPathSchema.optional(),
          page: TextPageSchema.optional(),
          provenance: ProvenanceSchema,
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
          matterKind: MatterKindSchema.optional(),
          sectionPath: SectionPathSchema.optional(),
          page: TextPageSchema.optional(),
          body: z.string(),
          provenance: ProvenanceSchema,
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
          page: z.number().optional().describe("PDF hits only: the page number."),
          section: z.number().optional().describe("EPUB hits only: the spine-section index (shown as §N)."),
          caption: z.string(),
          format: z.string(),
          source: z.string().optional(),
          cosine: z.number().optional(),
          rerankScore: z.number().optional(),
          charOffset: z.number(),
          contextCharStart: z.number().optional(),
          contextCharEnd: z.number().optional(),
          contextSnippet: z.string().optional(),
          provenance: ProvenanceSchema,
        }),
      )
      .optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, rawDeps: SemanticDeps) => {
    // the schema keeps a plain string (#590): an empty query gets the error contract, not the SDK's text
    if (args.query.trim() === "") {
      return toolError("invalid_input", "query is empty.", { hint: "pass a non-empty query: a word or phrase" });
    }
    // debug mode times every port call so latency shows up on the result itself
    const rec = rawDeps.config.logLevel === "debug" ? new TimingRecorder() : undefined;
    const deps = rec ? rec.wrap(rawDeps) : rawDeps;
    // the library whose text keyword half this call ran, for the debug keyword-plan line (#651)
    let keywordLib: string | undefined;
    const run = async (): Promise<ToolResult> => {
      try {
        const libraryId = await deps.content.resolveLibraryId(args.library);

        if (!deps.index.hasIndex(libraryId)) {
          return toolError(
            "index_missing",
            `No semantic index for this library yet. ${BUILD_LIBRARY_INDEX} (add keywordOnly=true to build a model-free keyword index).`,
            { hint: BUILD_LIBRARY_INDEX },
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
          // install steps only when the model is really missing; with it present a rebuild is the fix (#559)
          const modelReady = embedderUsable(deps.embedder);
          if (mode === "vector") {
            return toolError(
              "dependency_missing",
              modelReady
                ? 'This index was built keyword-only (no embeddings), so vector search is unavailable. The embedding model is available: rebuild with calibre_build_index { force: true } (without keywordOnly), or use mode:"keyword" now.'
                : `This index was built keyword-only (no embeddings), so vector search is unavailable. ${INSTALL_TRANSFORMERS} Then rebuild with calibre_build_index { force: true }, or use mode:"keyword" now (no model needed).`,
            );
          }
          mode = "keyword";
          note = modelReady
            ? "Index is keyword-only (no embeddings) — showing keyword (FTS) matches. For semantic ranking, rebuild with calibre_build_index force=true (the embedding model is available)."
            : `Index is keyword-only (no embeddings) — showing keyword (FTS) matches. For semantic ranking: ${INSTALL_TRANSFORMERS} Then rebuild with calibre_build_index force=true.`;
        }
        // 1–2 characters (Go, AI) are real queries, but carry little meaning for the embedder (#590)
        if (mode !== "keyword" && args.query.trim().length < 3) note = joinNotes(note, SHORT_QUERY_NOTE);
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
          // a numeric id is not looked up anywhere else: a book removed in the GUI may still have
          // rows, or have lost them to an earlier search's prune (#579)
          if (typeof effArgs.bookId === "number" && (await findGoneBookIds(deps, libraryId, [numericId])).size > 0) {
            return toolError(
              "not_found",
              `No book with id ${numericId} in this library: it was removed or merged since it was indexed. Find it again with calibre_search or a library-scope search.`,
            );
          }
          if (!deps.index.isBookIndexed(libraryId, numericId)) {
            return toolError(
              "index_missing",
              `Book ${numericId} is not indexed. Run calibre_build_index { bookId: ${numericId} } first.`,
              { hint: `Run calibre_build_index { bookId: ${numericId} } first` },
            );
          }
          if (effArgs.target === "figures") {
            return withIndexVersion(await figuresTarget(effArgs, deps, libraryId, numericId, sem, note), indexVersion);
          }
          if (mode !== "vector") keywordLib = libraryId;
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
        if (!fr.ok) return toolErrorFrom(fr.cause, filterErrorText(fr, deps.config.writeEnabled));
        const allow = await restrictSet(deps, fr.res, effArgs.library);
        const scope: FilterCtx = { fRes: fr.res, ...(allow ? { allow } : {}) };
        const indexed = allow ? [...allow].filter((id) => deps.index.isBookIndexed(libraryId, id)).length : undefined;
        note = joinNotes(note, ...honestyLines(fr.res, allow?.size, indexed));

        if (effArgs.target === "figures") {
          return withIndexVersion(
            await figuresTarget(effArgs, deps, libraryId, undefined, sem, note, scope),
            indexVersion,
          );
        }
        if (mode !== "vector") keywordLib = libraryId;
        return withIndexVersion(await libraryScope(effArgs, deps, libraryId, sem, note, scope), indexVersion);
      } catch (err) {
        return mapError(err);
      }
    };
    const res = await run();
    return withTimings(rec ? withDropped(res, rawDeps.index, keywordLib, args.query) : res, rec);
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
function filterFields(scope: FilterCtx): {
  filter?: string;
  exclusionsApplied?: string[];
  exclusionsRemoved?: number;
} {
  return {
    ...(scope.fRes.bundle ? { filter: scope.fRes.bundle.name } : {}),
    ...(scope.fRes.markers.length > 0 ? { exclusionsApplied: scope.fRes.markers.map((m) => m.name) } : {}),
    ...(scope.fRes.excludedBooks !== undefined ? { exclusionsRemoved: scope.fRes.excludedBooks } : {}),
  };
}

/**
 * The index ports calibre_semantic_search uses (#272): presence/provenance checks plus chunk and
 * figure retrieval, and the prune of rows whose book the library no longer holds (#579).
 */
export type SemanticIndex = Pick<IndexFreshness, "hasIndex" | "indexMeta" | "hasVectors" | "isBookIndexed"> &
  ChunkIndex &
  FigureIndex &
  // a text hit's section and page labels (#708)
  SectionIndex &
  // debug output: what the keyword plan left out (#651)
  KeywordPlanReport &
  // the one write: best-effort prune of hits whose book is gone (#579)
  Pick<IndexWriter, "deleteBooks">;
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
    searchMode: args.mode,
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
  const rr = await retrieve(
    deps,
    {
      scope: "library",
      libraryId,
      query: args.query,
      mode: args.mode,
      topK: args.topK,
      ...(scope.allow ? { allow: scope.allow } : {}),
      // books removed or merged in the GUI since the last pruning build drop out here (#579)
      gone: (ids) => findGoneBookIds(deps, libraryId, ids),
    },
    deps.retrievalOptions,
  );
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
  const debug = deps.config.logLevel === "debug";
  for (const r of ranked) {
    const link = bookResourceLink({ id: r.hit.bookId, title: r.hit.title, authors: r.hit.authors }, libraryId);
    link.description = [scoreLabel(r), r.hit.authors.join(", ")].filter(Boolean).join(" — ");
    blocks.push(link);
    const at = r.hit.snippetStart !== undefined ? ` snippet@${r.hit.snippetStart}` : "";
    const fenced = fence(
      `MATCH book ${r.hit.bookId} @${r.hit.charStart}-${r.hit.charEnd}${at}${matterLabel(r.hit.matterKind)}`,
      r.hit.snippet,
    );
    // library scope: the snippet's start decides, so a window past a section start shows that section
    const labels = hitLabels(deps.index, {
      libraryId,
      bookId: r.hit.bookId,
      offset: r.hit.snippetStart ?? r.hit.charStart,
    });
    blocks.push({ type: "text", text: withProvenanceLine(labelLines(labels) + fenced, r, debug) });
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
      ...matterField(r.hit.matterKind),
      ...labels,
      ...provenanceField(r, debug),
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
  // retrieve() also places front/back matter after body passages (#18, #605) and reports it in notes.
  const rr = await retrieve(
    deps,
    {
      scope: "book",
      libraryId,
      bookId,
      query: args.query,
      mode: args.mode,
      topK: args.topK,
    },
    deps.retrievalOptions,
  );
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
  const debug = deps.config.logLevel === "debug";
  for (const r of ranked) {
    const kind = r.hit.matterKind ?? "body";
    const fenced = fence(
      `PASSAGE @${r.hit.charStart}-${r.hit.charEnd}${matterLabel(kind)} ${scoreLabel(r)}`,
      r.hit.body,
    );
    // book scope: the whole chunk is shown, so its start decides
    const labels = hitLabels(deps.index, { libraryId, bookId, offset: r.hit.charStart });
    blocks.push({ type: "text", text: withProvenanceLine(labelLines(labels) + fenced, r, debug) });
    passages.push({
      charStart: r.hit.charStart,
      charEnd: r.hit.charEnd,
      ...(r.cosine !== undefined ? { cosine: r.cosine } : {}),
      ...(r.rerankScore !== undefined ? { rerankScore: r.rerankScore } : {}),
      ...matterField(kind),
      ...labels,
      body: fenced,
      ...provenanceField(r, debug),
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

  const rr = await retrieve(
    deps,
    {
      scope: "figures",
      libraryId,
      query: args.query,
      mode: args.mode,
      topK: args.topK,
      ...(bookId !== undefined ? { bookId } : {}),
      ...(scope.allow ? { allow: scope.allow } : {}),
      // scope=book was checked before ranking; library-wide hits drop gone books here (#579)
      ...(bookId === undefined ? { gone: (ids: readonly number[]) => findGoneBookIds(deps, libraryId, ids) } : {}),
    },
    deps.retrievalOptions,
  );
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
        ? ` §N on EPUB hits = spine-section index (EPUB has no pages; same number as the calibre_get_figures listing).`
        : ""),
    note,
  );
  const blocks: ContentBlock[] = [{ type: "text", text: head }];
  const figures: Record<string, unknown>[] = [];
  const debug = deps.config.logLevel === "debug";
  for (const r of ranked) {
    const h = r.hit;
    const ctx = deps.index.chunkAt(libraryId, h.bookId, h.charOffset);
    const snippet = ctx ? ctx.body.slice(0, SNIPPET_CHARS) : undefined;
    // EPUB's number is the spine-section index, not a page (#553) — same as the get_figures listing.
    const pagePart = `${figureLocationLabel(h.format, h.page)},`;
    const srcPart = h.source ? ` ${h.source},` : "";
    const fenced = fence(
      `FIGURE book ${h.bookId} #${h.figIndex} (${pagePart}${srcPart} @${h.charOffset}) ${scoreLabel(r)}`,
      h.caption + (snippet ? `\n--- context @${ctx!.charStart}-${ctx!.charEnd} ---\n${snippet}` : ""),
    );
    blocks.push({
      type: "text",
      text: `Figure #${h.figIndex} in "${h.title}" (book ${h.bookId}) — fetch: calibre_get_figures { bookId: ${h.bookId}, indexes: [${h.figIndex}] }\n${withProvenanceLine(fenced, r, debug)}`,
    });
    figures.push({
      bookId: h.bookId,
      title: h.title,
      authors: h.authors,
      figIndex: h.figIndex,
      ...figureLocation(h.format, h.page),
      caption: h.caption,
      format: h.format,
      ...(h.source !== undefined ? { source: h.source } : {}),
      ...(r.cosine !== undefined ? { cosine: r.cosine } : {}),
      ...(r.rerankScore !== undefined ? { rerankScore: r.rerankScore } : {}),
      charOffset: h.charOffset,
      ...(ctx ? { contextCharStart: ctx.charStart, contextCharEnd: ctx.charEnd } : {}),
      ...(snippet !== undefined ? { contextSnippet: snippet } : {}),
      ...provenanceField(r, debug),
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

/** Debug level (#650): the hit's provenance as a structured field; nothing at the default level. */
function provenanceField(r: { provenance?: HitProvenance }, debug: boolean): { provenance?: HitProvenance } {
  return debug && r.provenance ? { provenance: r.provenance } : {};
}

/** Debug level (#650): one provenance line right before the hit's fence, never inside the fenced book text. */
function withProvenanceLine(fenced: string, r: { provenance?: HitProvenance }, debug: boolean): string {
  if (!debug || !r.provenance) return fenced;
  const p = r.provenance;
  const parts = [
    ...(p.vectorRank !== undefined ? [`vector #${p.vectorRank}`] : []),
    ...(p.keywordRank !== undefined ? [`keyword #${p.keywordRank}`] : []),
    ...(p.fusedRank !== undefined ? [`fused #${p.fusedRank}`] : []),
    p.rerankPool ? "rerank pool" : "not in rerank pool",
    ...(p.chunkFrom
      ? [
          `chunk from ${p.chunkFrom}` +
            (p.otherRerankScore !== undefined ? ` (other chunk rerank ${p.otherRerankScore.toFixed(3)})` : ""),
        ]
      : []),
  ];
  return `debug: ${parts.join(" · ")}\n${fenced}`;
}

/** Debug mode: append the stage breakdown to the header text + structuredContent (successes only). */
function withTimings(res: ToolResult, rec: TimingRecorder | undefined): ToolResult {
  if (!rec || res.isError) return res;
  const timings = rec.snapshot();
  const [first, ...rest] = res.content;
  const line = timingsLine(timings);
  const content: ContentBlock[] =
    first?.type === "text"
      ? [{ ...first, text: `${first.text}\n${line}` }, ...rest]
      : [{ type: "text", text: line }, ...res.content];
  return { ...res, content, structuredContent: { ...res.structuredContent, timings } };
}

/**
 * Debug mode (#651): the keyword plan's dropped terms after the header text and in
 * structuredContent, for a call whose text keyword half ran in `libraryId` (successes only).
 */
function withDropped(
  res: ToolResult,
  index: KeywordPlanReport,
  libraryId: string | undefined,
  query: string,
): ToolResult {
  if (libraryId === undefined || res.isError) return res;
  const dropped = index.keywordDropped(libraryId, query);
  const line =
    dropped === undefined
      ? "Keyword plan (debug): no term statistics for this library, MATCH built from every query word"
      : dropped.length === 0
        ? "Keyword plan (debug): nothing dropped"
        : `Keyword plan (debug): dropped ${dropped.map((d) => `${d.term} (${d.reason})`).join(", ")}`;
  const [first, ...rest] = res.content;
  const content: ContentBlock[] =
    first?.type === "text"
      ? [{ ...first, text: `${first.text}\n${line}` }, ...rest]
      : [{ type: "text", text: line }, ...res.content];
  return { ...res, content, ...(dropped ? { structuredContent: { ...res.structuredContent, dropped } } : {}) };
}

/** Prepend a degrade/advisory note to a header block (kept in the text so all clients see it). */
function withNote(text: string, note?: string): string {
  return note ? `${note}\n${text}` : text;
}

/** Fold the mode-degrade and rerank-degrade notes into one advisory string. */
function joinNotes(...notes: (string | undefined)[]): string | undefined {
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
