// calibre_semantic_search — meaning-based retrieval over the local index (the project's
// headline differentiator). Two scopes and three modes, one tool (no extra surface, DESIGN §2):
//   scope=library : rank BOOKS by their best-matching passage → resource_links + scores
//   scope=book    : rank PASSAGES within one book → fenced excerpts with char locations
//   mode=hybrid   : RRF-fuse the vector (cosine) and keyword (FTS5 bm25) halves — the default,
//     best recall; mode=vector = semantic only; mode=keyword = FTS only (needs no model).
// Requires an index built by calibre_build_index; returns an actionable error otherwise.
// Snippets are untrusted book text → fenced. Cosine below config.semanticFloor → low-confidence.

import { z } from "zod";
import { rrfFuse } from "../semantic/fusion.js";
import { stemText } from "../semantic/stem.js";
import type { BookHit, LibraryHit } from "../semantic/store.js";
import { BookId, limitParam } from "./coerce.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { resolveNumericId } from "./resolve-id.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ContentBlock, ToolDeps } from "./types.js";

/** Per-half candidate pool the fuser draws from (design: vector top-50 + keyword top-50). */
const POOL = 50;

type Mode = "hybrid" | "vector" | "keyword";

export const semanticSearchTool = defineTool({
  name: "calibre_semantic_search",
  title: "Semantic search",
  description:
    "Meaning-based search over the embeddings index. scope=library ranks books; scope=book (needs bookId) ranks passages within one book. mode=hybrid (default) fuses semantic + keyword matches; mode=vector is semantic-only; mode=keyword is exact keyword/FTS (no model needed). Build the index first with calibre_build_index.",
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
    bookIds: z.array(z.number()).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) => {
    try {
      const libraryId = await deps.content.resolveLibraryId(args.library);

      if (!deps.index.hasIndex(libraryId)) {
        return toolError(
          "No semantic index for this library yet. Run calibre_build_index with a bookId, ids, or query first.",
        );
      }

      if (args.scope === "book") {
        if (args.bookId === undefined) {
          return toolError("scope=book requires bookId (the book to search within).");
        }
        const numericId = await resolveNumericId(deps, args.bookId, args.library);
        if (numericId === undefined) return toolError(`No book with id/uuid ${args.bookId}`);
        if (!deps.index.isBookIndexed(libraryId, numericId)) {
          return toolError(
            `Book ${numericId} is not indexed. Run calibre_build_index { bookId: ${numericId} } first.`,
          );
        }
        return await bookScope(args, deps, libraryId, numericId);
      }

      return await libraryScope(args, deps, libraryId);
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
}
/** A passage result plus its cosine, when the vector half contributed it. */
interface RankedPassage {
  hit: BookHit;
  cosine?: number;
}

/** scope=library — rank books; emit resource_links + fenced snippets. */
async function libraryScope(args: Args, deps: ToolDeps, libraryId: string) {
  const ranked = await rankBooks(args, deps, libraryId);
  if (ranked.length === 0) {
    return toolOk([{ type: "text", text: `No matches for "${args.query}".` }], {
      scope: "library",
      mode: args.mode,
      count: 0,
      bookIds: [],
    });
  }

  const { maxScore, lowConfidence } = confidence(ranked, deps);
  const blocks: ContentBlock[] = [
    { type: "text", text: header("book", ranked.length, args, maxScore, lowConfidence) },
  ];
  for (const r of ranked) {
    const link = bookResourceLink({ id: r.hit.bookId, title: r.hit.title, authors: r.hit.authors });
    link.description = [scoreLabel(r), r.hit.authors.join(", ")].filter(Boolean).join(" — ");
    blocks.push(link);
    blocks.push({
      type: "text",
      text: fence(`MATCH book ${r.hit.bookId} @${r.hit.charStart}-${r.hit.charEnd}`, r.hit.snippet),
    });
  }

  return toolOk(blocks, {
    scope: "library",
    mode: args.mode,
    count: ranked.length,
    maxScore,
    lowConfidence,
    bookIds: ranked.map((r) => r.hit.bookId),
  });
}

/** scope=book — rank passages within one book; emit fenced excerpts with char spans. */
async function bookScope(args: Args, deps: ToolDeps, libraryId: string, bookId: number) {
  const ranked = await rankPassages(args, deps, libraryId, bookId);
  if (ranked.length === 0) {
    return toolOk([{ type: "text", text: `No passages in book ${bookId} matched "${args.query}".` }], {
      scope: "book",
      mode: args.mode,
      bookId,
      count: 0,
    });
  }

  const { maxScore, lowConfidence } = confidence(ranked, deps);
  const head =
    header("passage", ranked.length, args, maxScore, lowConfidence) +
    ` Re-read any passage via calibre_get_content (cursor at its char offset).`;

  const blocks: ContentBlock[] = [{ type: "text", text: head }];
  for (const r of ranked) {
    blocks.push({
      type: "text",
      text: fence(`PASSAGE @${r.hit.charStart}-${r.hit.charEnd} ${scoreLabel(r)}`, r.hit.body),
    });
  }

  return toolOk(blocks, { scope: "book", mode: args.mode, bookId, count: ranked.length, maxScore, lowConfidence });
}

/** Rank books per mode. hybrid RRF-fuses the two halves; vector/keyword use one half each. */
async function rankBooks(args: Args, deps: ToolDeps, libraryId: string): Promise<RankedBook[]> {
  if (args.mode === "keyword") {
    return deps.index
      .searchLibraryFts(libraryId, stemText(args.query), args.topK)
      .map((hit) => ({ hit }));
  }
  const q = await deps.embedder.embedQuery(args.query);
  if (args.mode === "vector") {
    return deps.index.searchLibrary(libraryId, q, args.topK).map((hit) => ({ hit, cosine: hit.score }));
  }
  // hybrid: fuse book rankings from both halves by bookId.
  const vec = deps.index.searchLibrary(libraryId, q, POOL);
  const kw = deps.index.searchLibraryFts(libraryId, stemText(args.query), POOL);
  const vById = new Map(vec.map((h) => [h.bookId, h]));
  const kById = new Map(kw.map((h) => [h.bookId, h]));
  return rrfFuse([vec.map((h) => h.bookId), kw.map((h) => h.bookId)])
    .slice(0, args.topK)
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
  const q = await deps.embedder.embedQuery(args.query);
  if (args.mode === "vector") {
    return deps.index.searchBook(libraryId, bookId, q, args.topK).map((hit) => ({ hit, cosine: hit.score }));
  }
  const vec = deps.index.searchBook(libraryId, bookId, q, POOL);
  const kw = deps.index.searchBookFts(libraryId, bookId, stemText(args.query), POOL);
  const vById = new Map(vec.map((h) => [h.chunkId, h]));
  const kById = new Map(kw.map((h) => [h.chunkId, h]));
  return rrfFuse([vec.map((h) => h.chunkId), kw.map((h) => h.chunkId)])
    .slice(0, args.topK)
    .map((f) => {
      const v = vById.get(f.id);
      return { hit: (v ?? kById.get(f.id))!, cosine: v?.score };
    });
}

/** Confidence signal comes from the cosine half; keyword-only results carry none. */
function confidence(ranked: Array<{ cosine?: number }>, deps: ToolDeps) {
  const cosines = ranked.map((r) => r.cosine).filter((c): c is number => c !== undefined);
  const maxScore = cosines.length ? Math.max(...cosines) : undefined;
  const lowConfidence = maxScore !== undefined && maxScore < deps.config.semanticFloor;
  return { maxScore, lowConfidence };
}

/** Per-result score label: cosine when vector-backed, else "keyword match". */
function scoreLabel(r: { cosine?: number }): string {
  return r.cosine !== undefined ? `cosine ${r.cosine.toFixed(3)}` : "keyword match";
}

function header(
  unit: string,
  n: number,
  args: Args,
  maxScore: number | undefined,
  lowConfidence: boolean,
): string {
  return (
    `Top ${n} ${unit}(s) for "${args.query}" [${args.mode}]` +
    (maxScore !== undefined ? ` (max cosine ${maxScore.toFixed(3)})` : "") +
    (lowConfidence ? " — low confidence, treat as weak matches." : "")
  );
}

/** Map subsystem errors to LLM-actionable messages (mirrors calibre_get_content). */
function mapError(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "EMBEDDER_UNAVAILABLE") {
    return toolError(
      "Semantic (vector/hybrid) search needs the embedding model. Install it (pnpm add @huggingface/transformers), or use mode:\"keyword\" which needs no model.",
    );
  }
  if (m.startsWith("INDEX_INCOMPATIBLE")) {
    return toolError(m.replace(/^INDEX_INCOMPATIBLE:\s*/, ""));
  }
  return toolError(m);
}
