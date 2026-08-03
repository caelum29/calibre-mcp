// calibre_quality_report — scan the library (or an ids/query subset) for metadata problems:
// missing fields, raw-filename titles, invalid ISBNs, author-sort mismatches, series gaps.
// Read-only; the raw-filename findings feed calibre_recover_metadata. readability (Flesch/Fog
// over full text) is deferred — it needs text extraction, not just metadata.

import { z } from "zod";
import { ALL_CHECKS, type QualityCheck, runQualityChecks } from "../domain/curation/quality.js";
import { buildScopedQuery, honestyLines, resolveFilter } from "./bundles.js";
import { BookId, CursorParam, jsonArray, limitParam } from "./coerce.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { defineTool } from "./define.js";
import { selectBooks } from "./select-books.js";
import { fence, toolError, toolOk } from "./result.js";

const CHECK_ENUM = z.enum([
  "missing_metadata",
  "raw_filename_title",
  "isbn_invalid",
  "author_sort_mismatch",
  "series_gaps",
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
    readability: z.boolean().optional(),
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
    nextCursor: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    try {
      const checks: QualityCheck[] = args.checks?.length ? args.checks : ALL_CHECKS;

      // Bundle filter (#93): maintenance tools scope by filter but never auto-subtract
      // exclusion markers — quality work is most needed exactly on the noise books.
      if (args.filter !== undefined && args.ids?.length) {
        return toolError("Pass either ids or filter (a bundle name), not both.");
      }
      const fr = await resolveFilter(deps, { filter: args.filter, autoExclude: false, library: args.library });
      if (!fr.ok) return toolError(fr.error);

      const { books, total: matched, capped } = await selectBooks(deps, {
        ids: args.ids,
        query: buildScopedQuery(args.query ?? "", fr.res) || undefined,
        library: args.library,
      });
      const issues = runQualityChecks(books, checks);

      // Counts by check over ALL issues (not just the page).
      const byCheck: Record<string, number> = {};
      for (const i of issues) byCheck[i.check] = (byCheck[i.check] ?? 0) + 1;

      const cursorKey = `qual:${checks.slice().sort().join(",")}:${args.query ?? ""}:${args.filter ?? ""}`;
      const cur = decodeCursor(args.cursor);
      const offset = cur && cur.query === cursorKey ? cur.offset : 0;
      const page = issues.slice(offset, offset + args.limit);
      const more = offset + page.length < issues.length;
      const nextCursor = more
        ? encodeCursor({ offset: offset + page.length, query: cursorKey })
        : undefined;

      // The count is only the bundle's size when the bundle alone selected the set.
      const honesty = honestyLines(fr.res, args.filter !== undefined && !args.query ? matched : undefined);
      const summary =
        (honesty.length ? `${honesty.join("\n")}\n` : "") +
        `${issues.length} issue(s) across ${books.length} books scanned` +
        `${capped ? ` (capped — ${matched} matched)` : ""}. ` +
        `Showing ${page.length ? offset + 1 : 0}–${offset + page.length}. ` +
        `By check: ${Object.entries(byCheck).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}.` +
        (args.readability ? "\nreadability check is deferred in v1 (needs full-text extraction)." : "");

      const lines = page.map(
        (i) => `[${i.severity}] #${i.bookId} "${i.title}" — ${i.check}: ${i.message}`,
      );
      const text = `${summary}\n${lines.join("\n")}`;

      return toolOk([{ type: "text", text: fence("QUALITY REPORT", text) }], {
        total: issues.length,
        offset,
        count: page.length,
        booksScanned: books.length,
        capped,
        byCheck,
        nextCursor,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});
