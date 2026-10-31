// calibre_search — metadata/FTS search over a library or within one book.
//   scope=library mode=meta : Content Server /ajax/search (exact fields, query syntax)
//   scope=library mode=fts  : Content Server /fts/search (ranked, no snippets) + per-book snippets
//   scope=book              : full-text search inside one book (forces FTS; bookId required)
// Every Calibre sub-call of one call shares a single Deadline, so the reply always beats the
// client's 60 s timeout (the old 30 s + 60 s per-call timeouts stacked to 90 s).
// Large result sets come back as resource_links + an app-level nextCursor (DESIGN §2);
// FTS snippets are fenced as untrusted book text.

import { z } from "zod";
import type { SnippetBatch } from "../calibre/fts.js";
import {
  CalibreBusyError,
  CalibreCliTimeoutError,
  CalibreHttpTimeoutError,
  CalibreNotFoundError,
  DeadlineExceededError,
  FtsError,
} from "../domain/errors.js";
import type { FtsIndexing } from "../domain/search.js";
import { Deadline } from "../shared/deadline.js";
import type { BoardPayload } from "../ui/board-cache.js";
import {
  buildScopedQuery,
  type FilterResolution,
  honestyLines,
  isScoped,
  restrictSet,
  resolveFilter,
  scopeExpression,
} from "../app/bundles.js";
import { BookId, CoercedBool, CursorParam, limitParam } from "./coerce.js";
import { pageCursor, resolveCursor } from "./cursor.js";
import { boardMeta } from "./board-meta.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { resolveNumericId } from "./resolve-id.js";
import { ENABLE_FTS_STEPS, KEYWORD_SEARCH_FALLBACK } from "./remediation.js";
import { fence, renderResult, toolError, toolOk } from "./result.js";
import type { ContentBlock, ToolResult } from "./types.js";
import type { ToolDeps } from "./deps.js";
import { errorCodeFor } from "../domain/error-codes.js";

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

/**
 * Honesty suffix (#93): what the filter layer scoped/subtracted, appended to the TEXT
 * result (clients strip structuredContent — silence there would be silent subtraction).
 * The bundle count is the post-exclusion scope size: reuses the restrict set where one
 * was computed, else one cheap /ajax/search?num=0 on the scope expression.
 */
async function filterSuffix(
  deps: ToolDeps,
  fRes: FilterResolution,
  deadline: Deadline,
  scope: { library?: string; size?: number } = {},
): Promise<string> {
  const { library, size: scopeSize } = scope;
  let n = scopeSize;
  if (n === undefined && fRes.bundle) {
    const timeoutMs = deadline.timeoutFor();
    n = (await deps.content.search({ query: scopeExpression(fRes), library, num: 0, timeoutMs })).total;
  }
  const lines = honestyLines(fRes, n);
  return lines.length ? `\n${lines.join("\n")}` : "";
}

/** scope=library, mode=meta — Content Server /ajax/search (the original v1 path). */
async function metaLibraryScope(
  args: SearchArgs,
  deps: ToolDeps,
  fRes: FilterResolution,
  deadline: Deadline,
): Promise<ToolResult> {
  // The bundle scope expands into the server-side query; the cursor keys on the EFFECTIVE
  // query so a page walk that changes filter args can't silently replay a stale offset.
  const effQuery = buildScopedQuery(args.query, fRes);
  const libId = await deps.content.resolveLibraryId(args.library);
  // sortOrder too: flipping asc→desc reverses the list the offset points into.
  const sort = [args.sort, args.sortOrder].filter(Boolean).join(":") || undefined;
  const bind = { libId, mode: "search:meta", query: effQuery, sort };
  const start = resolveCursor(args.cursor, bind, "calibre_search");
  if (!start.ok) return toolError("invalid_input", start.error);
  const offset = start.offset;

  const page = await deps.content.search({
    query: effQuery,
    library: args.library,
    // countOnly needs only the total — don't ask the server for a full page of ids
    num: args.countOnly ? 1 : args.limit,
    offset,
    sort: args.sort,
    sortOrder: args.sortOrder,
    timeoutMs: deadline.timeoutFor(),
  });
  const honesty = await filterSuffix(deps, fRes, deadline, { library: args.library });

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
  const pg = pageCursor({ offset, fetched, total: page.total, ...bind });
  const text = `Found ${page.total} books, showing ${offset + 1}–${offset + fetched}.${honesty}`;

  const _meta = boardMeta(deps, "calibre_search", {
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
    ...renderResult({
      blocks: [{ type: "text", text }, ...links],
      structured: {
        total: page.total,
        offset,
        count: fetched,
        bookIds: page.bookIds,
        mode: "meta",
        ...structuredFilterFields(fRes),
      },
      page: pg,
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

/**
 * Lead-line notes for an FTS index that isn't complete: books not yet indexed can't match, so a
 * short list must not read as the whole answer (Honest outcome). Search still runs — Calibre's
 * own refusal threshold (90 %, calibredb only) would hide everything already indexed.
 */
function indexingNote(ix: FtsIndexing): string {
  if (ix.total === 0) return "\nFTS index is empty — no book files indexed yet, so nothing can match.";
  if (ix.left <= 0) return "";
  const done = ix.total - ix.left;
  const pct = Math.floor((done / ix.total) * 100);
  return `\nFTS index ${pct}% complete (${done} of ${ix.total} book files) — books not yet indexed can't match.`;
}

/** Lead-line note when snippet fetching stopped early, naming why and how to get the rest. */
function snippetNote(batch: SnippetBatch, pageSize: number): string {
  if (batch.skipped.length === 0) return "";
  const why: Record<NonNullable<SnippetBatch["stoppedBy"]>, string> = {
    budget: "snippet time budget reached",
    timeout: "Calibre stopped answering in time",
    busy: "Calibre is busy",
    error: "a snippet request failed",
  };
  const shown = pageSize - batch.skipped.length;
  return (
    `\nSnippets for ${shown} of ${pageSize} books on this page (${why[batch.stoppedBy ?? "error"]}); ` +
    `for one book's snippets use scope="book" with its bookId.`
  );
}

/**
 * Render an FTS query for a result header. A query that already carries quotes (a phrase or a
 * boolean with inner phrases) goes in backticks so the header never reads `""event sourcing""` (#309).
 */
function quotedQuery(query: string): string {
  if (!query.includes('"')) return `"${query}"`;
  // A backtick inside would close a single-backtick span early — fence with two instead.
  return query.includes("`") ? `\`\` ${query} \`\`` : `\`${query}\``;
}

/** One FTS call's inputs and shared budget, threaded through both FTS scopes. */
interface FtsCall {
  args: SearchArgs;
  deps: ToolDeps;
  fts: NonNullable<ToolDeps["fts"]>;
  deadline: Deadline;
  signal?: AbortSignal;
}

/** scope=library, mode=fts — ranked FTS matches → resource_links + fenced per-book snippets. */
async function ftsLibraryScope(call: FtsCall, fRes: FilterResolution): Promise<ToolResult> {
  const { args, deps, fts, deadline, signal } = call;
  const libId = await deps.content.resolveLibraryId(args.library);
  // Filter args change what an offset means — key the cursor on the scoped query. Checked
  // before matching so a bad cursor is refused even when nothing matches (#305).
  const cursorKey = isScoped(fRes) ? `${args.query}::${scopeExpression(fRes)}` : args.query;
  const bind = { libId, mode: "search:fts", query: cursorKey };
  const start = resolveCursor(args.cursor, bind, "calibre_search");
  if (!start.ok) return toolError("invalid_input", start.error);
  const offset = start.offset;
  // The FTS query is raw match syntax — no Calibre grammar to expand a bundle into — so
  // the filter restricts by book-id set instead (one /ajax/search on the scope expression).
  const allow = await restrictSet(deps, fRes, args.library, deadline.timeoutFor());
  const matches = await fts.match(args.query, libId, { deadline, signal });
  const bookIds = allow === undefined ? matches.bookIds : matches.bookIds.filter((id) => allow.has(id));
  const scope = { library: args.library, size: allow?.size };
  const honesty = (await filterSuffix(deps, fRes, deadline, scope)) + indexingNote(matches.indexing);
  const incomplete = matches.indexing.left > 0 ? { indexing: matches.indexing } : {};

  if (bookIds.length === 0) {
    // Zero results attach no board (issue #68).
    return toolOk([{ type: "text", text: `0 full-text matches for ${quotedQuery(args.query)}.${honesty}` }], {
      total: 0,
      offset: 0,
      count: 0,
      mode: "fts",
      hits: [],
      ...incomplete,
    });
  }

  // Count intent (issue #67): the ranked list already has the total — no snippets, no board.
  if (args.countOnly) {
    return toolOk(
      [
        {
          type: "text",
          text: `${bookIds.length} books have full-text matches for ${quotedQuery(args.query)}.${honesty}`,
        },
      ],
      { total: bookIds.length, query: args.query, mode: "fts", ...structuredFilterFields(fRes), ...incomplete },
    );
  }

  const pageIds = bookIds.slice(offset, offset + args.limit);
  // Snippets only for the visible page, one book at a time, under the call's budget.
  const batch = await fts.snippets(args.query, libId, pageIds, { deadline, signal });
  const meta = (id: number) => matches.books.get(id) ?? { title: `book ${id}`, authors: [] };

  const blocks: ContentBlock[] = [
    {
      type: "text",
      text:
        `Found ${bookIds.length} books with full-text matches for ${quotedQuery(args.query)}, showing ${offset + 1}–${offset + pageIds.length}.` +
        `${snippetNote(batch, pageIds.length)}${honesty}`,
    },
  ];
  const ftsHits: { bookId: number; snippet: string }[] = [];
  for (const id of pageIds) {
    blocks.push(bookResourceLink({ id, ...meta(id) }));
    const snips = (batch.byBook.get(id) ?? []).slice(0, 3).join("\n…\n");
    if (snips) {
      const snippet = fence("FTS SNIPPET", snips);
      blocks.push({ type: "text", text: snippet });
      ftsHits.push({ bookId: id, snippet });
    }
  }

  const pg = pageCursor({ offset, fetched: pageIds.length, total: bookIds.length, ...bind });
  const _meta = boardMeta(deps, "calibre_search", {
    query: args.query,
    kind: "keyword",
    libraryId: libId,
    total: bookIds.length,
    ...boardFilterFields(fRes),
    books: pageIds.map((id) => ({ bookId: id, ...meta(id) })),
  });
  return {
    ...renderResult({
      blocks,
      structured: {
        total: bookIds.length,
        offset,
        count: pageIds.length,
        bookIds: pageIds,
        mode: "fts",
        hits: ftsHits,
        ...(batch.skipped.length > 0 ? { snippetsSkipped: batch.skipped } : {}),
        ...structuredFilterFields(fRes),
        ...incomplete,
      },
      page: pg,
    }),
    _meta,
  };
}

/** scope=book — full-text search within one book; returns fenced in-book snippets. */
async function ftsBookScope(call: FtsCall, bookId: number): Promise<ToolResult> {
  const { args, deps, fts, deadline, signal } = call;
  const libId = await deps.content.resolveLibraryId(args.library);
  // Refuse a bad cursor before the snippet request, and even when the book has 0 matches (#305).
  const cursorKey = `${args.query}::book:${bookId}`;
  const bind = { libId, mode: "search:book", query: cursorKey };
  const start = resolveCursor(args.cursor, bind, "calibre_search");
  if (!start.ok) return toolError("invalid_input", start.error);
  const offset = start.offset;
  const batch = await fts.snippets(args.query, libId, [bookId], { deadline, signal });
  // The one book's request stalled — say so rather than report "0 matches".
  if (batch.skipped.length > 0) throw new DeadlineExceededError(deadline.totalMs);
  const snippets = batch.byBook.get(bookId) ?? [];

  // Count intent (issue #67): report the match count without paging snippets.
  if (args.countOnly) {
    return toolOk(
      [{ type: "text", text: `${snippets.length} in-book matches for ${quotedQuery(args.query)} in book ${bookId}.` }],
      { total: snippets.length, query: args.query, bookId, scope: "book", mode: "fts" },
    );
  }

  if (snippets.length === 0) {
    return toolOk([{ type: "text", text: `0 in-book matches for ${quotedQuery(args.query)} in book ${bookId}.` }], {
      total: 0,
      offset: 0,
      count: 0,
      bookId,
      scope: "book",
      mode: "fts",
      hits: [],
    });
  }

  const pageSnips = snippets.slice(offset, offset + args.limit);

  // Calibre FTS has no in-book offsets or ranking control, so front-matter hits (TOC/praise) can
  // top the list. When a better path exists for this book, say so (issue #18).
  const tip =
    deps.index?.hasIndex(libId) && deps.index.isBookIndexed(libId, bookId)
      ? ` Tip: for definitional/topic queries, calibre_semantic_search { scope: "book", bookId: ${bookId} } returns ranked passages with char offsets and demotes front matter.`
      : "";

  const snippetHits = pageSnips.map((s) => ({ snippet: fence("FTS SNIPPET", s) }));
  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: `${snippets.length} in-book matches for ${quotedQuery(args.query)} in book ${bookId}, showing ${offset + 1}–${offset + pageSnips.length}.${tip}`,
    },
    ...snippetHits.map((h): ContentBlock => ({ type: "text", text: h.snippet })),
  ];

  return renderResult({
    blocks,
    structured: {
      total: snippets.length,
      offset,
      count: pageSnips.length,
      bookId,
      scope: "book",
      mode: "fts",
      hits: snippetHits,
    },
    page: pageCursor({ offset, fetched: pageSnips.length, total: snippets.length, ...bind }),
  });
}

/**
 * Map each Calibre failure cause to its own steer (Discriminating catch). Returns undefined for
 * errors this tool has no specific advice for.
 */
function searchErrorSteer(err: unknown, deadline: Deadline): string | undefined {
  // A missing calibredb binary carries its own install hint — don't blame the index.
  if (err instanceof CalibreNotFoundError) return err.message;
  if (err instanceof FtsError) {
    if (err.code === "FTS_DISABLED") {
      return `Full-text search is not enabled for library "${err.libraryId}". ${ENABLE_FTS_STEPS} ${KEYWORD_SEARCH_FALLBACK}`;
    }
    // FTS5 reads `-`/`:` in a bare query as operators/column filters; a phrase bypasses that.
    // AND/OR/NOT are valid but binary: a leading/trailing one (`NOT foo`) is a syntax error.
    return (
      "Full-text search couldn't parse that query (FTS is working — the syntax is the problem). " +
      "Retry with the phrase wrapped in double quotes, or drop - and : from bare words; AND/OR/NOT go between terms (a NOT b), never first or last."
    );
  }
  if (err instanceof CalibreBusyError) return `${err.message} ${KEYWORD_SEARCH_FALLBACK}`;
  if (
    err instanceof DeadlineExceededError ||
    err instanceof CalibreHttpTimeoutError ||
    err instanceof CalibreCliTimeoutError
  ) {
    return (
      `Search stopped at its ${Math.round(deadline.totalMs / 1000)} s time budget: Calibre didn't answer in time — ` +
      "most likely it is still finishing an earlier full-text search (Calibre can't cancel one once started). " +
      `Retry in about a minute, or narrow it with bookId (one book) or filter (a bundle). ${KEYWORD_SEARCH_FALLBACK}`
    );
  }
  return undefined;
}

export const searchTool = defineTool({
  name: "calibre_search",
  title: "Search books",
  description:
    'Find books by exact title, author, ISBN, tag, or Calibre query syntax (mode=meta), or by full text (mode=fts). mode=fts words match independently and stemmed (events matches event); wrap a phrase in double quotes for an exact match ("event sourcing"); supports AND/OR/NOT between terms (uppercase, e.g. a NOT b). scope=book returns short keyword snippets from inside one book; first hits often land in TOC/front matter — for definitional or topic questions within a book prefer calibre_semantic_search scope=book (ranked passages with char offsets). Use calibre_semantic_search for meaning/topic queries. For "how many" questions use countOnly=true (returns only the count). filter accepts a bundle name to scope the search (list bundles via calibre_manage_bundles).',
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
    // FTS snippets mirrored for structured-only clients (#199), fenced exactly like the text
    // blocks; bookId is set on library-scope hits (one entry per book with snippets).
    hits: z.array(z.object({ bookId: z.number().optional(), snippet: z.string() })).optional(),
    // Page books whose snippets weren't fetched (time budget / stalled Calibre) — see the lead line.
    snippetsSkipped: z.array(z.number()).optional(),
    // Present only while the library's FTS index is incomplete: unindexed books can't match.
    indexing: z.object({ left: z.number(), total: z.number() }).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps, ctx) => {
    // One budget for every Calibre sub-call below (bundle listing, id resolution, FTS, snippets).
    const deadline = new Deadline();
    try {
      const fts = deps.fts;
      // scope=book → full-text within one book (metadata search on a single record is moot).
      // Bundles scope LIBRARY discovery; a named book is already the narrowest scope.
      if (args.scope === "book") {
        if (args.filter !== undefined) {
          return toolError(
            "invalid_input",
            "filter (bundle) applies to scope=library only — scope=book already names one book.",
          );
        }
        if (args.bookId === undefined) return toolError("invalid_input", "scope=book requires bookId");
        if (!fts)
          return toolError(
            "fts_unavailable",
            `Full-text search isn't available in this server build. ${KEYWORD_SEARCH_FALLBACK}`,
          );
        const bookId = await resolveNumericId(deps, args.bookId, args.library);
        if (bookId === undefined) return toolError("not_found", `No book with id/uuid ${args.bookId}`);
        return await ftsBookScope({ args, deps, fts, deadline, signal: ctx?.signal }, bookId);
      }
      const fr = await resolveFilter(deps, {
        filter: args.filter,
        includeExcluded: args.include_excluded,
        autoExclude: true,
        library: args.library,
        timeoutMs: deadline.timeoutFor(),
      });
      if (!fr.ok)
        return fr.cause === undefined ? toolError("not_found", fr.error) : toolError(errorCodeFor(fr.cause), fr.error);
      if (args.mode === "fts") {
        if (!fts)
          return toolError(
            "fts_unavailable",
            `Full-text search isn't available in this server build. ${KEYWORD_SEARCH_FALLBACK}`,
          );
        return await ftsLibraryScope({ args, deps, fts, deadline, signal: ctx?.signal }, fr.res);
      }
      return await metaLibraryScope(args, deps, fr.res, deadline);
    } catch (err) {
      const steer = searchErrorSteer(err, deadline);
      if (steer !== undefined) return toolError(errorCodeFor(err), steer);
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(errorCodeFor(err), msg);
    }
  },
});
