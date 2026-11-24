// calibre_search_annotations — your highlights, bookmarks and item notes (#598, ADR-0035).
// Split out of calibre_search so "what did I highlight about X?" has its own tool: kind=annotations
// (highlights, their notes, bookmark titles) or kind=notes (notes on authors/series/tags/publisher).
// Calibre 9.18+; read-only; no board widget (the hits are text, not book cards). The work is in
// search-annotations.ts.

import { z } from "zod";
import { Deadline } from "../shared/deadline.js";
import { BookId, CoercedBool, limitParam, OptionalFilter } from "./coerce.js";
import { defineTool } from "./define.js";
import { errorFromCatch, toolError } from "./result.js";
import { searchAnnotationsOrNotes } from "./search-annotations.js";

export const searchAnnotationsTool = defineTool({
  name: "calibre_search_annotations",
  title: "Search highlights and notes",
  description:
    'Search your highlights, bookmarks and item notes by `query` (Calibre 9.18+). kind=annotations (default): highlights, their notes and bookmark titles; filter (a bundle name) applies; scope=book + bookId searches one book, and query "*" lists all its annotations. kind=notes: notes attached to authors, series, tags, publisher (filters do not apply); query "authors:Name" (or series:/tags:/publisher:/#custom:, item may be quoted) shows the whole note of that item. Results come in Calibre\'s relevance order, capped by limit; countOnly=true returns only the count. For finding books use calibre_search.',
  inputSchema: {
    query: z.string().max(512),
    kind: z.enum(["annotations", "notes"]).optional().default("annotations"),
    scope: z.enum(["library", "book"]).optional().default("library"),
    bookId: BookId().optional(),
    library: z.string().optional(),
    limit: limitParam(50, 20),
    countOnly: CoercedBool().optional(),
    filter: OptionalFilter(),
    include_excluded: CoercedBool().optional(),
  },
  outputSchema: {
    total: z.number().optional(),
    query: z.string().optional(),
    count: z.number().optional(),
    mode: z.string().optional(),
    scope: z.string().optional(),
    filter: z.string().optional(),
    exclusionsApplied: z.array(z.string()).optional(),
    exclusionsRemoved: z.number().optional(),
    // kind=annotations (#500): highlights and bookmarks, in Calibre's relevance order
    annotations: z
      .array(
        z.object({
          id: z.number().optional(),
          bookId: z.number(),
          title: z.string().optional(),
          format: z.string(),
          type: z.string(),
          text: z.string(),
          note: z.string().optional(),
          chapter: z.string().optional(),
          timestamp: z.string().optional(),
          user: z.string(),
        }),
      )
      .optional(),
    // kind=notes (#500): the item each note is attached to, plus Calibre's snippet
    notes: z
      .array(
        z.object({ field: z.string(), item: z.string(), snippet: z.string().optional(), text: z.string().optional() }),
      )
      .optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps, ctx) => {
    // the schema keeps a plain string (#590): an empty query gets the error contract, not the SDK's text
    if (args.query.trim() === "") {
      return toolError("invalid_input", "query is empty.", {
        hint: 'pass a non-empty query (kind=annotations with scope=book: "*" lists all annotations)',
      });
    }
    try {
      return await searchAnnotationsOrNotes(args, deps, new Deadline(), ctx?.signal);
    } catch (err) {
      return errorFromCatch(err);
    }
  },
});
