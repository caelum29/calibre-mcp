// calibre_semantic_search — meaning-based retrieval over the local vector index (the
// project's headline differentiator). Two scopes, one tool (no extra surface, DESIGN §2):
//   scope=library : rank BOOKS by their best-matching passage → resource_links + scores
//   scope=book    : rank PASSAGES within one book → fenced excerpts with char locations
// Requires an index built by calibre_build_index; returns an actionable error otherwise.
// Snippets are untrusted book text → fenced. Cosine below config.semanticFloor → low-confidence.

import { z } from "zod";
import { BookId, limitParam } from "./coerce.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { resolveNumericId } from "./resolve-id.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ContentBlock, ToolDeps } from "./types.js";

export const semanticSearchTool = defineTool({
  name: "calibre_semantic_search",
  title: "Semantic search",
  description:
    "Meaning-based search over the embeddings index. scope=library ranks books; scope=book (needs bookId) ranks passages within one book. Build the index first with calibre_build_index. For exact keyword/phrase matches use calibre_search.",
  inputSchema: {
    query: z.string().min(1).max(512),
    scope: z.enum(["library", "book"]).default("library"),
    bookId: BookId().optional(),
    topK: limitParam(50, 10),
    library: z.string().optional(),
  },
  outputSchema: {
    scope: z.string().optional(),
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
  bookId?: number | string;
  topK: number;
  library?: string;
};

/** scope=library — rank books by best passage; emit resource_links + fenced snippets. */
async function libraryScope(args: Args, deps: ToolDeps, libraryId: string) {
  const q = await deps.embedder.embedQuery(args.query);
  const hits = deps.index.searchLibrary(libraryId, q, args.topK);
  if (hits.length === 0) {
    return toolOk([{ type: "text", text: `No semantic matches for "${args.query}".` }], {
      scope: "library",
      count: 0,
      bookIds: [],
    });
  }

  const maxScore = hits[0]!.score;
  const lowConfidence = maxScore < deps.config.semanticFloor;
  const header =
    `Top ${hits.length} book(s) for "${args.query}" (max score ${maxScore.toFixed(3)})` +
    (lowConfidence ? " — low confidence, treat as weak matches." : "");

  const blocks: ContentBlock[] = [{ type: "text", text: header }];
  for (const h of hits) {
    const link = bookResourceLink({ id: h.bookId, title: h.title, authors: h.authors });
    link.description = [`score ${h.score.toFixed(3)}`, h.authors.join(", ")]
      .filter(Boolean)
      .join(" — ");
    blocks.push(link);
    blocks.push({
      type: "text",
      text: fence(`MATCH book ${h.bookId} @${h.charStart}-${h.charEnd}`, h.snippet),
    });
  }

  return toolOk(blocks, {
    scope: "library",
    count: hits.length,
    maxScore,
    lowConfidence,
    bookIds: hits.map((h) => h.bookId),
  });
}

/** scope=book — rank passages within one book; emit fenced excerpts with char spans. */
async function bookScope(args: Args, deps: ToolDeps, libraryId: string, bookId: number) {
  const q = await deps.embedder.embedQuery(args.query);
  const hits = deps.index.searchBook(libraryId, bookId, q, args.topK);
  if (hits.length === 0) {
    return toolOk([{ type: "text", text: `No passages in book ${bookId} matched "${args.query}".` }], {
      scope: "book",
      bookId,
      count: 0,
    });
  }

  const maxScore = hits[0]!.score;
  const lowConfidence = maxScore < deps.config.semanticFloor;
  const header =
    `Top ${hits.length} passage(s) in book ${bookId} for "${args.query}" (max score ${maxScore.toFixed(3)})` +
    (lowConfidence ? " — low confidence." : "") +
    ` Re-read any passage via calibre_get_content (cursor at its char offset).`;

  const blocks: ContentBlock[] = [{ type: "text", text: header }];
  for (const h of hits) {
    blocks.push({
      type: "text",
      text: fence(`PASSAGE @${h.charStart}-${h.charEnd} score ${h.score.toFixed(3)}`, h.body),
    });
  }

  return toolOk(blocks, { scope: "book", bookId, count: hits.length, maxScore, lowConfidence });
}

/** Map subsystem errors to LLM-actionable messages (mirrors calibre_get_content). */
function mapError(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "EMBEDDER_UNAVAILABLE") {
    return toolError(
      "Semantic search needs the embedding model. Install the optional dependency: pnpm add @huggingface/transformers.",
    );
  }
  if (m.startsWith("INDEX_INCOMPATIBLE")) {
    return toolError(m.replace(/^INDEX_INCOMPATIBLE:\s*/, ""));
  }
  return toolError(m);
}
