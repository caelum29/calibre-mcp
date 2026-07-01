// calibre_bulk_update (#12) — apply the SAME metadata changes to a SET of books. Gated write.
// Preview-first by default (computes a per-book diff WITHOUT writing); a book set is REQUIRED
// (ids or a non-empty query — never an all-books default, the FaceDeer anti-pattern we fix).
// Applies by looping `calibredb set_metadata` per book (no bulk CLI form; HTTP batch is LATER).

import { z } from "zod";
import {
  buildSetMetadataArgs,
  isAllowedField,
  previewBookChanges,
} from "../calibre/metadata-fields.js";
import type { ChangeValue } from "../calibre/metadata-fields.js";
import { BookId, CoercedBool, jsonArray, jsonRecord } from "./coerce.js";
import { defineTool } from "./define.js";
import { fence, toolError, toolOk } from "./result.js";
import { selectBooks } from "./select-books.js";
import { ChangeValueSchema } from "./calibre_update_book.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "./write-refusal.js";

/** Hard cap on books mutated in one call — a bulk write must be a deliberate, bounded set. */
const MAX_BULK = 500;

export const bulkUpdateTool = defineTool({
  name: "calibre_bulk_update",
  title: "Bulk update book metadata",
  description:
    "Apply the same metadata changes (tags, series, publisher, etc.) to a set of books selected " +
    "by ids or a search query. Preview-first: returns the per-book diff without writing unless " +
    "preview is set false. A book set is required (never all books). Requires writes to be enabled.",
  inputSchema: {
    changes: jsonRecord(ChangeValueSchema),
    ids: jsonArray(BookId()).optional(),
    query: z.string().optional(),
    library: z.string().optional(),
    preview: CoercedBool().default(true),
  },
  outputSchema: {
    preview: z.boolean().optional(),
    matched: z.number().optional(),
    books: z
      .array(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          changed: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })),
        }),
      )
      .optional(),
    applied: z.array(z.number()).optional(),
    failed: z.array(z.object({ id: z.number(), error: z.string() })).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  write: true,
  handler: async (args, deps) => {
    try {
      const changes = args.changes as Record<string, ChangeValue>;
      const fields = Object.keys(changes);
      if (fields.length === 0) return toolError("Provide at least one field in changes.");

      const unknown = fields.filter((f) => !isAllowedField(f));
      if (unknown.length > 0) {
        return toolError(
          `Unknown field(s): ${unknown.join(", ")}. Allowed: title, authors, tags, series, series_index, ` +
            `rating, publisher, pubdate, languages, comments, identifiers, or any #custom column.`,
        );
      }

      // A set is mandatory — refuse an unbounded all-books write (the FaceDeer default we fix).
      const hasIds = Array.isArray(args.ids) && args.ids.length > 0;
      const hasQuery = typeof args.query === "string" && args.query.trim().length > 0;
      if (!hasIds && !hasQuery) {
        return toolError("Select a book set: pass ids or a non-empty query (all-books is not allowed).");
      }

      const selection = await selectBooks(deps, {
        ids: hasIds ? args.ids : undefined,
        query: hasQuery ? args.query : undefined,
        library: args.library,
      });
      if (selection.books.length === 0) return toolError("No books matched the selection.");
      if (selection.capped || selection.books.length > MAX_BULK) {
        return toolError(
          `Selection too large (${selection.total}); the bulk write cap is ${MAX_BULK}. ` +
            `Narrow the query or pass explicit ids.`,
        );
      }

      const perBook = selection.books.map((b) => ({
        id: b.id,
        title: b.title,
        diff: previewBookChanges(b, changes),
      }));

      // Preview (default): show the diff, write nothing.
      if (args.preview) {
        const lines = perBook.map((b) => {
          const parts = b.diff.map(
            (d) =>
              `  ${d.field}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}` +
              (d.changed ? "" : " (no change)"),
          );
          return `#${b.id} ${b.title}\n${parts.join("\n")}`;
        });
        const changing = perBook.filter((b) => b.diff.some((d) => d.changed)).length;
        const text =
          `Preview — ${selection.books.length} book(s) selected, ${changing} would change. ` +
          `Re-run with preview=false to apply.\n` +
          fence("BULK UPDATE PREVIEW", lines.join("\n\n"));
        return toolOk([{ type: "text", text }], {
          preview: true,
          matched: selection.books.length,
          books: perBook.map((b) => ({
            id: b.id,
            title: b.title,
            changed: b.diff.map(({ field, before, after }) => ({ field, before, after })),
          })),
        });
      }

      // Apply: resolve the library ID once (calibredb needs the ID, not the display name), then
      // loop set_metadata per book. Per-book failures are collected, not fatal.
      const libId = await deps.content.resolveLibraryId(args.library);
      const applied: number[] = [];
      const failed: { id: number; error: string }[] = [];
      for (const b of perBook) {
        try {
          await deps.calibre.calibredb(buildSetMetadataArgs(b.id, changes), { library: libId });
          applied.push(b.id);
        } catch (err) {
          if (isWriteRefused(err)) return toolError(WRITE_REFUSED_MESSAGE);
          failed.push({ id: b.id, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const summary =
        `Applied ${fields.join(", ")} to ${applied.length}/${perBook.length} book(s).` +
        (failed.length > 0 ? ` ${failed.length} failed: ${failed.map((f) => f.id).join(", ")}.` : "");
      return toolOk([{ type: "text", text: summary }], {
        preview: false,
        matched: perBook.length,
        applied,
        failed,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});
