// calibre_find_duplicates — surface probable duplicate books so a human/agent can decide
// what to merge. `identical`/`similar` group the library (or a subset) by a normalized key
// with a merge-safety score; `compare` diffs an explicit id set field-by-field. READ-only:
// it never merges — Calibre's own merge is a separate, gated write.

import { z } from "zod";
import { compareBooks, findDuplicateGroups } from "../domain/curation/duplicates.js";
import { buildScopedQuery, honestyLines, resolveFilter } from "./bundles.js";
import { BookId, CursorParam, jsonArray, limitParam } from "./coerce.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { selectBooks } from "./select-books.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ContentBlock } from "./types.js";

export const findDuplicatesTool = defineTool({
  name: "calibre_find_duplicates",
  title: "Find duplicates",
  description:
    "Find probable duplicate books. mode=identical (exact title+authors) or similar (fuzzy) group the library (or ids/query/filter subset — filter takes a bundle name) with a merge-safety score; mode=compare diffs 2+ ids field-by-field. Read-only — never merges.",
  inputSchema: {
    mode: z.enum(["identical", "similar", "compare"]).default("identical"),
    ids: jsonArray(BookId()).optional(),
    query: z.string().max(512).optional(),
    filter: z.string().trim().min(1).max(256).optional(),
    library: z.string().optional(),
    limit: limitParam(200, 50),
    cursor: CursorParam,
  },
  outputSchema: {
    mode: z.string(),
    groupCount: z.number().optional(),
    offset: z.number().optional(),
    count: z.number().optional(),
    booksScanned: z.number().optional(),
    capped: z.boolean().optional(),
    nextCursor: z.string().optional(),
    // compare mode:
    keep: z.number().optional(),
    mergeSafety: z.number().optional(),
    languagesDiffer: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    try {
      if (args.mode === "compare") {
        if (!args.ids || args.ids.length < 2) {
          return toolError("compare mode requires ids with at least 2 book ids.");
        }
        const { books } = await selectBooks(deps, { ids: args.ids, library: args.library });
        if (books.length < 2) {
          return toolError(`compare needs 2+ resolvable books; got ${books.length}.`);
        }
        const report = compareBooks(books);
        const lines = report.diffs.map(
          (d) => `${d.agree ? "=" : "≠"} ${d.field}: ${d.values.join(" | ")}`,
        );
        // A differing-language pair is a translation, not a duplicate — say so loudly, since
        // the rest of the diff can look identical and read as a safe delete (#51).
        const langDiff = report.diffs.find((d) => d.field === "languages" && !d.agree);
        const warning = langDiff
          ? `\n⚠ REVIEW — languages differ (${langDiff.values.join(" | ")}): these look like ` +
            `different-language editions/translations, not duplicates. Do NOT merge or delete ` +
            `without confirming with the user.`
          : "";
        const text =
          `Comparing books ${report.bookIds.join(", ")} — ` +
          `mergeSafety ${report.mergeSafety.toFixed(2)}, recommend keeping book ${report.keep}\n` +
          lines.join("\n") +
          warning;
        return toolOk([{ type: "text", text: fence("COMPARISON", text) }], {
          mode: "compare",
          keep: report.keep,
          mergeSafety: report.mergeSafety,
          count: report.bookIds.length,
          languagesDiffer: langDiff !== undefined,
        });
      }

      // identical | similar → group the selection. Bundle filter (#93) scopes the sweep;
      // no auto-exclusion — dedupe is most needed exactly on the noise books.
      if (args.filter !== undefined && args.ids?.length) {
        return toolError("Pass either ids or filter (a bundle name), not both.");
      }
      const fr = await resolveFilter(deps, { filter: args.filter, autoExclude: false, library: args.library });
      if (!fr.ok) return toolError(fr.error);
      const { books, total, capped } = await selectBooks(deps, {
        ids: args.ids,
        query: buildScopedQuery(args.query ?? "", fr.res) || undefined,
        library: args.library,
      });
      const groups = findDuplicateGroups(books, args.mode);

      const cursorKey = `dup:${args.mode}:${args.query ?? ""}:${args.filter ?? ""}`;
      const cur = decodeCursor(args.cursor);
      const offset = cur && cur.query === cursorKey ? cur.offset : 0;
      const pageGroups = groups.slice(offset, offset + args.limit);
      const more = offset + pageGroups.length < groups.length;
      const nextCursor = more
        ? encodeCursor({ offset: offset + pageGroups.length, query: cursorKey })
        : undefined;

      const content: ContentBlock[] = [];
      // The count is only the bundle's size when the bundle alone selected the set.
      const honesty = honestyLines(fr.res, args.filter !== undefined && !args.query ? total : undefined);
      const header =
        (honesty.length ? `${honesty.join("\n")}\n` : "") +
        `${groups.length} duplicate group(s) across ${books.length} books scanned` +
        `${capped ? ` (capped — ${total} matched)` : ""}. ` +
        `Showing ${pageGroups.length ? offset + 1 : 0}–${offset + pageGroups.length}.\n` +
        "binary mode (byte-level dedupe) is deferred in v1.";
      content.push({ type: "text", text: header });

      for (const g of pageGroups) {
        // Show each book's language: a mixed-language group is a translation pair, not a
        // duplicate, and that must be visible before anyone merges (#51).
        const summary = g.books
          .map(
            (b) =>
              `#${b.id} "${b.title}" — ${b.authors.join(", ") || "?"}` +
              ` [${b.languages.join(", ") || "lang ?"}]`,
          )
          .join("\n");
        const mixedLangs = new Set(g.books.flatMap((b) => b.languages.map((l) => l.toLowerCase())));
        const note =
          mixedLangs.size > 1 ? "\n⚠ REVIEW — mixed languages: likely translations, not duplicates." : "";
        content.push({
          type: "text",
          text: fence("DUP GROUP", `mergeSafety ${g.mergeSafety.toFixed(2)}\n${summary}${note}`),
        });
        for (const b of g.books) {
          content.push(bookResourceLink({ id: b.id, title: b.title, authors: b.authors }));
        }
      }

      return toolOk(content, {
        mode: args.mode,
        groupCount: groups.length,
        offset,
        count: pageGroups.length,
        booksScanned: books.length,
        capped,
        nextCursor,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});
