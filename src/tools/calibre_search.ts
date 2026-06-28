// calibre_search — metadata/FTS search over a library or one book. v1 slice implements
// mode=meta + scope=library (via Content Server /ajax/search); fts and book-scope return
// an actionable "not yet implemented" so the model degrades gracefully. Large result sets
// come back as resource_links + an app-level nextCursor (DESIGN §2).

import { z } from "zod";
import { CursorParam, BookId, limitParam } from "./coerce.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { toolError, toolOk } from "./result.js";

export const searchTool = defineTool({
  name: "calibre_search",
  title: "Search books",
  description:
    "Find books by exact title, author, ISBN, tag, or Calibre query syntax. Use calibre_semantic_search for meaning/topic queries.",
  inputSchema: {
    query: z.string().min(1).max(512),
    mode: z.enum(["meta", "fts"]).optional().default("meta"),
    scope: z.enum(["library", "book"]).optional().default("library"),
    bookId: BookId().optional(),
    library: z.string().optional(),
    sort: z.enum(["title", "authors", "pubdate", "timestamp", "rating", "last_modified"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    limit: limitParam(50, 20),
    cursor: CursorParam,
  },
  outputSchema: {
    total: z.number().optional(),
    offset: z.number().optional(),
    count: z.number().optional(),
    nextCursor: z.string().optional(),
    bookIds: z.array(z.number()).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    if (args.mode !== "meta" || args.scope !== "library") {
      return toolError("fts/book-scoped search not yet implemented — use mode=meta scope=library");
    }
    try {
      // Cursor is bound to the query: a cursor from a different query resets to offset 0.
      const cur = decodeCursor(args.cursor);
      const offset = cur && cur.query === args.query ? cur.offset : 0;

      const page = await deps.content.search({
        query: args.query,
        library: args.library,
        num: args.limit,
        offset,
        sort: args.sort,
        sortOrder: args.sortOrder,
      });

      if (page.total === 0) {
        return toolOk([{ type: "text", text: `0 books matched "${args.query}".` }], {
          total: 0,
          offset: 0,
          count: 0,
          bookIds: [],
        });
      }

      const books = await deps.content.booksByIds(page.bookIds, args.library);
      const links = page.bookIds.map((id) => {
        const b = books.get(id);
        return bookResourceLink({
          id,
          title: b?.title ?? `book ${id}`,
          authors: b?.authors ?? [],
        });
      });

      const fetched = page.bookIds.length;
      const more = offset + fetched < page.total;
      const nextCursor = more
        ? encodeCursor({ offset: offset + fetched, query: args.query, sort: args.sort })
        : undefined;
      const text = `Found ${page.total} books, showing ${offset + 1}–${offset + fetched}.`;

      return toolOk([{ type: "text", text }, ...links], {
        total: page.total,
        offset,
        count: fetched,
        nextCursor,
        bookIds: page.bookIds,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
  },
});
