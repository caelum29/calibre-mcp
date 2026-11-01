// calibre_quality_report — scan the library (or an ids/query subset) for metadata problems:
// missing fields, raw-filename titles, invalid ISBNs, author-sort mismatches, series gaps, suspect (glued/junk) authors.
// Read-only; the raw-filename findings feed calibre_recover_metadata. readability (Flesch/Fog
// over full text) is deferred — it needs text extraction, not just metadata.

import { z } from "zod";
import { ALL_CHECKS, type QualityCheck, runQualityChecks } from "../domain/curation/quality.js";
import { buildScopedQuery, honestyLines, resolveFilter } from "../app/bundles.js";
import { BookId, CoercedBool, CursorParam, jsonArray, limitParam } from "./coerce.js";
import { pageCursor, pageOffset, selectionKey } from "./cursor.js";
import { defineTool } from "./define.js";
import { selectBooks } from "../app/select-books.js";
import { fence, renderResult, toolError, toolErrorFrom, errorFromCatch } from "./result.js";

const CHECK_ENUM = z.enum([
  "missing_metadata",
  "raw_filename_title",
  "isbn_invalid",
  "author_sort_mismatch",
  "series_gaps",
  "authors_suspect",
]);

export const qualityReportTool = defineTool({
  name: "calibre_quality_report",
  title: "Quality report",
  description:
    "Scan books for metadata problems: missing fields, raw-filename titles, invalid ISBNs, author-sort mismatches, series gaps. Defaults to the whole library; narrow with ids/query/filter (a bundle name) or specific checks. Read-only.",
  inputSchema: {
    checks: jsonArray(CHECK_ENUM).optional(),
    ids: jsonArray(BookId()).optional(),
    query: z.string().max(512).optional(),
    filter: z.string().trim().min(1).max(256).optional(),
    library: z.string().optional(),
    readability: CoercedBool().optional(),
    limit: limitParam(500, 100),
    cursor: CursorParam,
  },
  outputSchema: {
    total: z.number().optional(),
    offset: z.number().optional(),
    count: z.number().optional(),
    booksScanned: z.number().optional(),
    capped: z.boolean().optional(),
    byCheck: z.record(z.string(), z.number()).optional(),
    // The page's issues, mirroring the text lines for structured-only clients (#199).
    issues: z
      .array(
        z.object({
          bookId: z.number(),
          title: z.string(),
          check: z.string(),
          severity: z.string(),
          message: z.string(),
        }),
      )
      .optional(),
    nextCursor: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps, ctx) => {
    try {
      const checks: QualityCheck[] = args.checks?.length ? args.checks : ALL_CHECKS;

      // Bundle filter (#93): maintenance tools scope by filter but never auto-subtract
      // exclusion markers — quality work is most needed exactly on the noise books.
      if (args.filter !== undefined && args.ids?.length) {
        return toolError("invalid_input", "Pass either ids or filter (a bundle name), not both.");
      }
      // Every input that shapes the issue list is in the key, and a bad cursor is refused
      // before the (expensive) book selection (#305).
      const cursorKey = [checks.slice().sort().join(","), selectionKey(args)].join(":");
      const bind = { libId: await deps.content.resolveLibraryId(args.library), mode: "quality", query: cursorKey };
      const start = pageOffset(args.cursor, bind, "calibre_quality_report");
      if ("content" in start) return start;
      const offset = start.offset;

      const fr = await resolveFilter(deps, { filter: args.filter, autoExclude: false, library: args.library });
      if (!fr.ok) return toolErrorFrom(fr.cause, fr.error);

      ctx?.progress?.(0, "Selecting books…", 2);
      const {
        books,
        total: matched,
        capped,
      } = await selectBooks(deps, {
        ids: args.ids,
        query: buildScopedQuery(args.query ?? "", fr.res) || undefined,
        library: args.library,
      });
      ctx?.progress?.(1, `Checking ${books.length} book(s)…`, 2);
      const issues = runQualityChecks(books, checks);
      ctx?.progress?.(2, `Checked ${books.length} book(s)`, 2);

      // Counts by check over ALL issues (not just the page).
      const byCheck: Record<string, number> = {};
      for (const i of issues) byCheck[i.check] = (byCheck[i.check] ?? 0) + 1;

      const page = issues.slice(offset, offset + args.limit);

      // The count is only the bundle's size when the bundle alone selected the set.
      const honesty = honestyLines(fr.res, args.filter !== undefined && !args.query ? matched : undefined);
      const summary =
        (honesty.length ? `${honesty.join("\n")}\n` : "") +
        `${issues.length} issue(s) across ${books.length} books scanned` +
        `${capped ? ` (capped — ${matched} matched)` : ""}. ` +
        `Showing ${page.length ? offset + 1 : 0}–${offset + page.length}. ` +
        `By check: ${
          Object.entries(byCheck)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ") || "none"
        }.` +
        (args.readability ? "\nreadability check is not implemented yet (needs full-text extraction)." : "");

      const lines = page.map((i) => `[${i.severity}] #${i.bookId} "${i.title}" — ${i.check}: ${i.message}`);
      const text = `${summary}\n${lines.join("\n")}`;

      return renderResult({
        blocks: [{ type: "text", text: fence("QUALITY REPORT", text) }],
        structured: {
          total: issues.length,
          offset,
          count: page.length,
          booksScanned: books.length,
          capped,
          byCheck,
          issues: page.map(({ bookId, title, check, severity, message }) => ({
            bookId,
            title,
            check,
            severity,
            message,
          })),
        },
        page: pageCursor({ offset, fetched: page.length, total: issues.length, ...bind }),
      });
    } catch (err) {
      return errorFromCatch(err);
    }
  },
});
