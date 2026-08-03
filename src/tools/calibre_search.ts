// calibre_search — metadata/FTS search over a library or within one book.
//   scope=library mode=meta : Content Server /ajax/search (exact fields, query syntax)
//   scope=library mode=fts  : calibredb fts_search across the library
//   scope=book              : full-text search inside one book (forces FTS; bookId required)
// Large result sets come back as resource_links + an app-level nextCursor (DESIGN §2);
// FTS snippets are fenced as untrusted book text.

import { z } from "zod";
import { CalibreCliError, CalibreNotFoundError } from "../domain/errors.js";
import type { BoardPayload } from "../ui/board-cache.js";
import {
  buildScopedQuery,
  type FilterResolution,
  honestyLines,
  isScoped,
  restrictSet,
  resolveFilter,
  scopeExpression,
} from "./bundles.js";
import { BookId, CoercedBool, CursorParam, limitParam } from "./coerce.js";
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
  countOnly?: boolean;
  filter?: string;
  include_excluded?: boolean;
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

/**
 * Honesty suffix (#93): what the filter layer scoped/subtracted, appended to the TEXT
 * result (clients strip structuredContent — silence there would be silent subtraction).
 * The bundle count is the post-exclusion scope size: reuses the restrict set where one
 * was computed, else one cheap /ajax/search?num=0 on the scope expression.
 */
async function filterSuffix(
  deps: ToolDeps,
  fRes: FilterResolution,
  library?: string,
  scopeSize?: number,
): Promise<string> {
  let n = scopeSize;
  if (n === undefined && fRes.bundle) {
    n = (await deps.content.search({ query: scopeExpression(fRes), library, num: 0 })).total;
  }
  const lines = honestyLines(fRes, n);
  return lines.length ? `\n${lines.join("\n")}` : "";
}

/** scope=library, mode=meta — Content Server /ajax/search (the original v1 path). */
async function metaLibraryScope(args: SearchArgs, deps: ToolDeps, fRes: FilterResolution): Promise<ToolResult> {
  // The bundle scope expands into the server-side query; the cursor keys on the EFFECTIVE
  // query so a page walk that changes filter args can't silently replay a stale offset.
  const effQuery = buildScopedQuery(args.query, fRes);
  const cur = decodeCursor(args.cursor);
  const offset = cur && cur.query === effQuery ? cur.offset : 0;

  const page = await deps.content.search({
    query: effQuery,
    library: args.library,
    // countOnly needs only the total — don't ask the server for a full page of ids
    num: args.countOnly ? 1 : args.limit,
    offset,
    sort: args.sort,
    sortOrder: args.sortOrder,
  });
  const honesty = await filterSuffix(deps, fRes, args.library);

  // Count intent (issue #67): answer the aggregate question with COUNT(*) semantics —
  // no row fetch, no board, no cache write.
  if (args.countOnly) {
    return toolOk([{ type: "text", text: `${page.total} books match "${args.query}".${honesty}` }], {
      total: page.total,
      query: args.query,
    });
  }

  if (page.total === 0) {
    // Zero results attach no board (issue #68) — an empty shelf adds nothing over the text.
    return toolOk([{ type: "text", text: `0 books matched "${args.query}".${honesty}` }], {
      total: 0,
      offset: 0,
      count: 0,
      bookIds: [],
    });
  }

  const books = await deps.content.booksByIds(page.bookIds, args.library);
  const links = page.bookIds.map((id) => {
    const b = books.get(id);
    return bookResourceLink({ id, title: b?.title ?? `book ${id}`, authors: b?.authors ?? [] });
  });

  const fetched = page.bookIds.length;
  const more = offset + fetched < page.total;
  const nextCursor = more
    ? encodeCursor({ offset: offset + fetched, query: effQuery, sort: args.sort })
    : undefined;
  const text = `Found ${page.total} books, showing ${offset + 1}–${offset + fetched}.${honesty}`;

  const _meta = boardMeta(deps, {
    query: args.query,
    kind: "keyword",
    libraryId: page.libraryId,
    total: page.total,
    ...boardFilterFields(fRes),
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
      ...structuredFilterFields(fRes),
    }),
    _meta,
  };
}

/** BoardPayload filter/exclusion fields for a resolution (#93). */
function boardFilterFields(fRes: FilterResolution): Partial<BoardPayload> {
  return {
    ...(fRes.bundle ? { filter: fRes.bundle.name } : {}),
    ...(fRes.markers.length > 0 ? { exclusionsApplied: fRes.markers.map((m) => m.name) } : {}),
  };
}

/** The same fields mirrored into structuredContent for structured-only clients. */
function structuredFilterFields(fRes: FilterResolution): Record<string, unknown> {
  return boardFilterFields(fRes);
}

/** scope=library, mode=fts — group FTS hits by book → resource_links + fenced snippets. */
async function ftsLibraryScope(args: SearchArgs, deps: ToolDeps, fRes: FilterResolution): Promise<ToolResult> {
  // calibredb's --with-library fragment needs the library ID, not the display name
  // (the display form 404s) — resolve first, same as the write path (commit 71531d2).
  const libId = await deps.content.resolveLibraryId(args.library);
  // The FTS query is raw match syntax — no Calibre grammar to expand a bundle into — so
  // the filter restricts by book-id set instead (one /ajax/search on the scope expression).
  const allow = await restrictSet(deps, fRes, args.library);
  const rawHits = await deps.calibre.ftsSearch(args.query, {
    snippets: true,
    matchStartMarker: FTS_START,
    matchEndMarker: FTS_END,
    library: libId,
  });
  const hits = allow === undefined ? rawHits : rawHits.filter((h) => allow.has(h.bookId));
  const honesty = await filterSuffix(deps, fRes, args.library, allow?.size);

  if (hits.length === 0) {
    // Zero results attach no board (issue #68).
    return toolOk(
      [
        {
          type: "text",
          text: `0 full-text matches for "${args.query}". If you expected matches, the FTS index may not be built (calibredb fts_index --enable).${honesty}`,
        },
      ],
      { total: 0, offset: 0, count: 0, mode: "fts" },
    );
  }

  const byBook = new Map<number, string[]>();
  for (const h of hits) {
    const arr = byBook.get(h.bookId) ?? [];
    if (h.snippet) arr.push(h.snippet);
    byBook.set(h.bookId, arr);
  }

  const bookIds = [...byBook.keys()];

  // Count intent (issue #67): total is known after grouping — skip the row fetch and board.
  if (args.countOnly) {
    return toolOk(
      [{ type: "text", text: `${bookIds.length} books have full-text matches for "${args.query}".${honesty}` }],
      { total: bookIds.length, query: args.query, mode: "fts", ...structuredFilterFields(fRes) },
    );
  }

  // Filter args change what an offset means — key the cursor on the scoped query.
  const cursorKey = isScoped(fRes) ? `${args.query}::${scopeExpression(fRes)}` : args.query;
  const cur = decodeCursor(args.cursor);
  const offset = cur && cur.query === cursorKey ? cur.offset : 0;
  const pageIds = bookIds.slice(offset, offset + args.limit);
  const books = await deps.content.booksByIds(pageIds, args.library);

  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: `Found ${bookIds.length} books with full-text matches for "${args.query}", showing ${offset + 1}–${offset + pageIds.length}.${honesty}`,
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
    ? encodeCursor({ offset: offset + pageIds.length, query: cursorKey })
    : undefined;
  const _meta = boardMeta(deps, {
    query: args.query,
    kind: "keyword",
    libraryId: libId,
    total: bookIds.length,
    ...boardFilterFields(fRes),
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
      ...structuredFilterFields(fRes),
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

  // Count intent (issue #67): report the match count without paging snippets.
  if (args.countOnly) {
    return toolOk(
      [{ type: "text", text: `${snippets.length} in-book matches for "${args.query}" in book ${bookId}.` }],
      { total: snippets.length, query: args.query, bookId, scope: "book", mode: "fts" },
    );
  }

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
    "Find books by exact title, author, ISBN, tag, or Calibre query syntax (mode=meta), or by full text (mode=fts). scope=book returns short keyword snippets from inside one book; first hits often land in TOC/front matter — for definitional or topic questions within a book prefer calibre_semantic_search scope=book (ranked passages with char offsets). Use calibre_semantic_search for meaning/topic queries. For \"how many\" questions use countOnly=true (returns only the count). filter accepts a bundle name to scope the search (list bundles via calibre_manage_bundles).",
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
    countOnly: CoercedBool().optional(),
    filter: z.string().trim().min(1).max(256).optional(),
    include_excluded: CoercedBool().optional(),
  },
  outputSchema: {
    total: z.number().optional(),
    query: z.string().optional(),
    offset: z.number().optional(),
    count: z.number().optional(),
    nextCursor: z.string().optional(),
    bookIds: z.array(z.number()).optional(),
    mode: z.string().optional(),
    scope: z.string().optional(),
    bookId: z.number().optional(),
    filter: z.string().optional(),
    exclusionsApplied: z.array(z.string()).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    try {
      // scope=book → full-text within one book (metadata search on a single record is moot).
      // Bundles scope LIBRARY discovery; a named book is already the narrowest scope.
      if (args.scope === "book") {
        if (args.filter !== undefined) {
          return toolError("filter (bundle) applies to scope=library only — scope=book already names one book.");
        }
        if (args.bookId === undefined) return toolError("scope=book requires bookId");
        const bookId = await resolveNumericId(deps, args.bookId, args.library);
        if (bookId === undefined) return toolError(`No book with id/uuid ${args.bookId}`);
        return await ftsBookScope(args, deps, bookId);
      }
      const fr = await resolveFilter(deps, {
        filter: args.filter,
        includeExcluded: args.include_excluded,
        autoExclude: true,
        library: args.library,
      });
      if (!fr.ok) return toolError(fr.error);
      if (args.mode === "fts") return await ftsLibraryScope(args, deps, fr.res);
      return await metaLibraryScope(args, deps, fr.res);
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
