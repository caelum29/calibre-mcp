// calibre_search — metadata/FTS search over a library or within one book.
//   scope=library mode=meta : Content Server /ajax/search (exact fields, query syntax)
//   scope=library mode=fts  : calibredb fts_search across the library
//   scope=book              : full-text search inside one book (forces FTS; bookId required)
// Large result sets come back as resource_links + an app-level nextCursor (DESIGN §2);
// FTS snippets are fenced as untrusted book text.

import { z } from "zod";
import { CalibreCliError, CalibreNotFoundError } from "../domain/errors.js";
import type { BoardPayload } from "../ui/board-cache.js";
import { BookId, CursorParam, limitParam } from "./coerce.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { resolveNumericId } from "./resolve-id.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ContentBlock, ToolDeps, ToolResult } from "./types.js";

type SearchArgs = {
  query: string;
  mode: "meta" | "fts";
  scope: "library" | "book";
  bookId?: number | string;
  library?: string;
  sort?: "title" | "authors" | "pubdate" | "timestamp" | "rating" | "last_modified";
  sortOrder?: "asc" | "desc";
  limit: number;
  cursor?: string;
};

const FTS_START = ">>";
const FTS_END = "<<";

/**
 * Feed the cover-board widget (issue #22): cache the page for the widget's re-pull
 * (Desktop strips the tool-result notification) and return the `_meta` to attach for
 * spec hosts that forward it. Library-scope results only — scope=book renders passages
 * in chat and the widget collapses itself.
 */
function boardMeta(
  deps: ToolDeps,
  payload: Omit<BoardPayload, "tool" | "serverUrl">,
): Record<string, unknown> {
  const full: BoardPayload = { tool: "calibre_search", serverUrl: deps.config.serverUrl, ...payload };
  deps.boardCache?.set(full);
  return { calibreBoard: full };
}

/** scope=library, mode=meta — Content Server /ajax/search (the original v1 path). */
async function metaLibraryScope(args: SearchArgs, deps: ToolDeps): Promise<ToolResult> {
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
    const _meta = boardMeta(deps, {
      query: args.query,
      kind: "keyword",
      libraryId: page.libraryId,
      total: 0,
      books: [],
    });
    return {
      ...toolOk([{ type: "text", text: `0 books matched "${args.query}".` }], {
        total: 0,
        offset: 0,
        count: 0,
        bookIds: [],
      }),
      _meta,
    };
  }

  const books = await deps.content.booksByIds(page.bookIds, args.library);
  const links = page.bookIds.map((id) => {
    const b = books.get(id);
    return bookResourceLink({ id, title: b?.title ?? `book ${id}`, authors: b?.authors ?? [] });
  });

  const fetched = page.bookIds.length;
  const more = offset + fetched < page.total;
  const nextCursor = more
    ? encodeCursor({ offset: offset + fetched, query: args.query, sort: args.sort })
    : undefined;
  const text = `Found ${page.total} books, showing ${offset + 1}–${offset + fetched}.`;

  const _meta = boardMeta(deps, {
    query: args.query,
    kind: "keyword",
    libraryId: page.libraryId,
    total: page.total,
    books: page.bookIds.map((id) => {
      const b = books.get(id);
      return { bookId: id, title: b?.title ?? `book ${id}`, authors: b?.authors ?? [] };
    }),
  });

  return {
    ...toolOk([{ type: "text", text }, ...links], {
      total: page.total,
      offset,
      count: fetched,
      nextCursor,
      bookIds: page.bookIds,
      mode: "meta",
    }),
    _meta,
  };
}

/** scope=library, mode=fts — group FTS hits by book → resource_links + fenced snippets. */
async function ftsLibraryScope(args: SearchArgs, deps: ToolDeps): Promise<ToolResult> {
  // calibredb's --with-library fragment needs the library ID, not the display name
  // (the display form 404s) — resolve first, same as the write path (commit 71531d2).
  const libId = await deps.content.resolveLibraryId(args.library);
  const hits = await deps.calibre.ftsSearch(args.query, {
    snippets: true,
    matchStartMarker: FTS_START,
    matchEndMarker: FTS_END,
    library: libId,
  });

  if (hits.length === 0) {
    const _meta = boardMeta(deps, {
      query: args.query,
      kind: "keyword",
      libraryId: libId,
      total: 0,
      books: [],
    });
    return {
      ...toolOk(
        [
          {
            type: "text",
            text: `0 full-text matches for "${args.query}". If you expected matches, the FTS index may not be built (calibredb fts_index --enable).`,
          },
        ],
        { total: 0, offset: 0, count: 0, mode: "fts" },
      ),
      _meta,
    };
  }

  const byBook = new Map<number, string[]>();
  for (const h of hits) {
    const arr = byBook.get(h.bookId) ?? [];
    if (h.snippet) arr.push(h.snippet);
    byBook.set(h.bookId, arr);
  }

  const bookIds = [...byBook.keys()];
  const cur = decodeCursor(args.cursor);
  const offset = cur && cur.query === args.query ? cur.offset : 0;
  const pageIds = bookIds.slice(offset, offset + args.limit);
  const books = await deps.content.booksByIds(pageIds, args.library);

  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: `Found ${bookIds.length} books with full-text matches for "${args.query}", showing ${offset + 1}–${offset + pageIds.length}.`,
    },
  ];
  for (const id of pageIds) {
    const b = books.get(id);
    blocks.push(bookResourceLink({ id, title: b?.title ?? `book ${id}`, authors: b?.authors ?? [] }));
    const snips = (byBook.get(id) ?? []).slice(0, 3).join("\n…\n");
    if (snips) blocks.push({ type: "text", text: fence("FTS SNIPPET", snips) });
  }

  const more = offset + pageIds.length < bookIds.length;
  const nextCursor = more
    ? encodeCursor({ offset: offset + pageIds.length, query: args.query })
    : undefined;
  const _meta = boardMeta(deps, {
    query: args.query,
    kind: "keyword",
    libraryId: libId,
    total: bookIds.length,
    books: pageIds.map((id) => {
      const b = books.get(id);
      return { bookId: id, title: b?.title ?? `book ${id}`, authors: b?.authors ?? [] };
    }),
  });
  return {
    ...toolOk(blocks, {
      total: bookIds.length,
      offset,
      count: pageIds.length,
      nextCursor,
      bookIds: pageIds,
      mode: "fts",
    }),
    _meta,
  };
}

/** scope=book — full-text search within one book; returns fenced in-book snippets. */
async function ftsBookScope(args: SearchArgs, deps: ToolDeps, bookId: number): Promise<ToolResult> {
  const libId = await deps.content.resolveLibraryId(args.library);
  const hits = await deps.calibre.ftsSearch(args.query, {
    restrictToIds: [bookId],
    snippets: true,
    matchStartMarker: FTS_START,
    matchEndMarker: FTS_END,
    library: libId,
  });
  const snippets = hits.map((h) => h.snippet).filter((s): s is string => Boolean(s));

  if (snippets.length === 0) {
    return toolOk([{ type: "text", text: `0 in-book matches for "${args.query}" in book ${bookId}.` }], {
      total: 0,
      offset: 0,
      count: 0,
      bookId,
      scope: "book",
      mode: "fts",
    });
  }

  const cursorKey = `${args.query}::book:${bookId}`;
  const cur = decodeCursor(args.cursor);
  const offset = cur && cur.query === cursorKey ? cur.offset : 0;
  const pageSnips = snippets.slice(offset, offset + args.limit);

  // calibredb FTS has no offsets or ranking control, so front-matter hits (TOC/praise) can
  // top the list. When a better path exists for this book, say so (issue #18).
  const tip =
    deps.index?.hasIndex(libId) && deps.index.isBookIndexed(libId, bookId)
      ? ` Tip: for definitional/topic queries, calibre_semantic_search { scope: "book", bookId: ${bookId} } returns ranked passages with char offsets and demotes front matter.`
      : "";

  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: `${snippets.length} in-book matches for "${args.query}" in book ${bookId}, showing ${offset + 1}–${offset + pageSnips.length}.${tip}`,
    },
    ...pageSnips.map((s): ContentBlock => ({ type: "text", text: fence("FTS SNIPPET", s) })),
  ];

  const more = offset + pageSnips.length < snippets.length;
  const nextCursor = more ? encodeCursor({ offset: offset + pageSnips.length, query: cursorKey }) : undefined;
  return toolOk(blocks, {
    total: snippets.length,
    offset,
    count: pageSnips.length,
    nextCursor,
    bookId,
    scope: "book",
    mode: "fts",
  });
}

export const searchTool = defineTool({
  name: "calibre_search",
  title: "Search books",
  description:
    "Find books by exact title, author, ISBN, tag, or Calibre query syntax (mode=meta), or by full text (mode=fts). scope=book returns short keyword snippets from inside one book; first hits often land in TOC/front matter — for definitional or topic questions within a book prefer calibre_semantic_search scope=book (ranked passages with char offsets). Use calibre_semantic_search for meaning/topic queries.",
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
    mode: z.string().optional(),
    scope: z.string().optional(),
    bookId: z.number().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    try {
      // scope=book → full-text within one book (metadata search on a single record is moot).
      if (args.scope === "book") {
        if (args.bookId === undefined) return toolError("scope=book requires bookId");
        const bookId = await resolveNumericId(deps, args.bookId, args.library);
        if (bookId === undefined) return toolError(`No book with id/uuid ${args.bookId}`);
        return await ftsBookScope(args, deps, bookId);
      }
      if (args.mode === "fts") return await ftsLibraryScope(args, deps);
      return await metaLibraryScope(args, deps);
    } catch (err) {
      // A missing calibredb binary carries its own install hint — don't blame the index.
      if (err instanceof CalibreNotFoundError) return toolError(err.message);
      // calibredb is only invoked on the FTS paths, so any CLI failure here means the
      // full-text index isn't ready (snippet requests hang/time out without an index).
      if (err instanceof CalibreCliError) {
        return toolError(
          "Full-text search isn't ready for this library. Enable indexing in Calibre " +
            "(Preferences → Searching → Full text search), wait for it to finish, then retry.",
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
  },
});
