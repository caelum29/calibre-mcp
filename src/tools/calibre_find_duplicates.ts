// calibre_find_duplicates — surface probable duplicate books so a human/agent can decide
// what to merge. `identical`/`similar` group the library (or a subset) by a normalized key
// with a merge-safety score; `compare` diffs an explicit id set field-by-field. READ-only:
// it never merges — Calibre's own merge is a separate, gated write.

import { filterErrorText } from "./writes-remedy.js";
import { z } from "zod";
import { compareBooks, findDuplicateGroups } from "../domain/curation/duplicates.js";
import { buildScopedQuery, honestyLines, resolveFilter } from "../app/bundles.js";
import { BookId, CursorParam, jsonArray, limitParam } from "./coerce.js";
import { pageCursor, pageOffset, selectionKey } from "./cursor.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { selectBooks } from "../app/select-books.js";
import { fence, renderResult, toolError, toolOk, toolErrorFrom, errorFromCatch } from "./result.js";
import type { ContentBlock } from "./types.js";
import type { WorkMatch } from "../domain/curation/normalize.js";

/** REVIEW line for a set that may not be one work (#550); undefined for `same`. */
function workMatchNote(m: WorkMatch): string | undefined {
  if (m === "edition?") {
    return (
      "⚠ REVIEW — possibly different editions: one title names a later edition " +
      '(e.g. "Second Edition"), the other none. Confirm with the user before merging.'
    );
  }
  if (m === "different") {
    return "⚠ REVIEW — not the same work (title, author or edition mismatch). Do NOT merge without confirming with the user.";
  }
  return undefined;
}

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
    // same | edition? | different — the shared same-work verdict (#550); not same caps mergeSafety.
    workMatch: z.string().optional(),
    // Mirrors of the text payload for structured-only clients (#199): the page's group
    // boundaries (identical/similar) and the field-by-field diff + compared ids (compare).
    groups: z
      .array(
        z.object({
          bookIds: z.array(z.number()),
          mergeSafety: z.number(),
          mixedLanguages: z.boolean(),
          workMatch: z.string(),
        }),
      )
      .optional(),
    bookIds: z.array(z.number()).optional(),
    diff: z.array(z.object({ field: z.string(), agree: z.boolean(), values: z.array(z.string()) })).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    try {
      // Every input that shapes the group list is in the key, and a bad cursor is refused
      // before the (expensive) book selection — compare mode included, it never pages (#305).
      const libId = await deps.content.resolveLibraryId(args.library);
      const bind = {
        libId,
        mode: `dup:${args.mode}`,
        query: selectionKey(args),
      };
      const start = pageOffset(args.cursor, bind, "calibre_find_duplicates");
      if ("content" in start) return start;
      const offset = start.offset;

      if (args.mode === "compare") {
        if (!args.ids || args.ids.length < 2) {
          return toolError("invalid_input", "compare mode requires ids with at least 2 book ids.");
        }
        const { books } = await selectBooks(deps, { ids: args.ids, library: args.library });
        if (books.length < 2) {
          return toolError("not_found", `compare needs 2+ resolvable books; got ${books.length}.`);
        }
        const report = compareBooks(books);
        const lines = report.diffs.map((d) => `${d.agree ? "=" : "≠"} ${d.field}: ${d.values.join(" | ")}`);
        // A differing-language pair is a translation, not a duplicate — say so loudly, since
        // the rest of the diff can look identical and read as a safe delete (#51).
        const langDiff = report.diffs.find((d) => d.field === "languages" && !d.agree);
        const warning = langDiff
          ? `\n⚠ REVIEW — languages differ (${langDiff.values.join(" | ")}): these look like ` +
            `different-language editions/translations, not duplicates. Do NOT merge or delete ` +
            `without confirming with the user.`
          : "";
        const workNote = workMatchNote(report.workMatch);
        const text =
          `Comparing books ${report.bookIds.join(", ")} — ` +
          `mergeSafety ${report.mergeSafety.toFixed(2)}, recommend keeping book ${report.keep}\n` +
          // legend ties the =/≠ marks to diff[].agree, so both channels read the same way (#199)
          "Legend: = values agree, ≠ values differ\n" +
          lines.join("\n") +
          warning +
          (workNote ? `\n${workNote}` : "");
        return toolOk([{ type: "text", text: fence("COMPARISON", text) }], {
          mode: "compare",
          keep: report.keep,
          mergeSafety: report.mergeSafety,
          count: report.bookIds.length,
          languagesDiffer: langDiff !== undefined,
          workMatch: report.workMatch,
          bookIds: report.bookIds,
          diff: report.diffs.map(({ field, agree, values }) => ({ field, agree, values })),
        });
      }

      // identical | similar → group the selection. Bundle filter (#93) scopes the sweep;
      // no auto-exclusion — dedupe is most needed exactly on the noise books.
      if (args.filter !== undefined && args.ids?.length) {
        return toolError("invalid_input", "Pass either ids or filter (a bundle name), not both.");
      }
      const fr = await resolveFilter(deps, { filter: args.filter, autoExclude: false, library: args.library });
      if (!fr.ok) return toolErrorFrom(fr.cause, filterErrorText(fr, deps.config.writeEnabled));
      const { books, total, capped } = await selectBooks(deps, {
        ids: args.ids,
        query: buildScopedQuery(args.query ?? "", fr.res) || undefined,
        library: args.library,
      });
      const groups = findDuplicateGroups(books, args.mode);

      const pageGroups = groups.slice(offset, offset + args.limit);
      const pg = pageCursor({ offset, fetched: pageGroups.length, total: groups.length, ...bind });

      const content: ContentBlock[] = [];
      // The count is only the bundle's size when the bundle alone selected the set.
      const honesty = honestyLines(fr.res, args.filter !== undefined && !args.query ? total : undefined);
      const header =
        (honesty.length ? `${honesty.join("\n")}\n` : "") +
        `${groups.length} duplicate group(s) across ${books.length} books scanned` +
        `${capped ? ` (capped — ${total} matched)` : ""}. ` +
        `Showing ${pageGroups.length ? offset + 1 : 0}–${offset + pageGroups.length}.`;
      content.push({ type: "text", text: header });

      const groupModels: { bookIds: number[]; mergeSafety: number; mixedLanguages: boolean; workMatch: WorkMatch }[] =
        [];
      for (const g of pageGroups) {
        // Show each book's language: a mixed-language group is a translation pair, not a
        // duplicate, and that must be visible before anyone merges (#51).
        const summary = g.books
          .map(
            (b) =>
              `#${b.id} "${b.title}" — ${b.authors.join(", ") || "?"}` + ` [${b.languages.join(", ") || "lang ?"}]`,
          )
          .join("\n");
        const mixedLangs = new Set(g.books.flatMap((b) => b.languages.map((l) => l.toLowerCase())));
        const workNote = workMatchNote(g.workMatch);
        const note =
          (mixedLangs.size > 1 ? "\n⚠ REVIEW — mixed languages: likely translations, not duplicates." : "") +
          (workNote ? `\n${workNote}` : "");
        groupModels.push({
          bookIds: g.books.map((b) => b.id),
          mergeSafety: g.mergeSafety,
          mixedLanguages: mixedLangs.size > 1,
          workMatch: g.workMatch,
        });
        content.push({
          type: "text",
          text: fence("DUP GROUP", `mergeSafety ${g.mergeSafety.toFixed(2)}\n${summary}${note}`),
        });
        for (const b of g.books) {
          content.push(bookResourceLink({ id: b.id, title: b.title, authors: b.authors }, libId));
        }
      }

      return renderResult({
        blocks: content,
        structured: {
          mode: args.mode,
          groupCount: groups.length,
          offset,
          count: pageGroups.length,
          booksScanned: books.length,
          capped,
          groups: groupModels,
        },
        page: pg,
      });
    } catch (err) {
      return errorFromCatch(err);
    }
  },
});
