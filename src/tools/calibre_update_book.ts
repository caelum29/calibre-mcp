// calibre_update_book — the first gated WRITE tool. Sets metadata fields on one book via
// `calibredb set_metadata`, routed through the Content Server URL (GUI-safe). Disabled
// unless CALIBRE_MCP_ENABLE_WRITE is on (server.ts gate). Reports an applied diff and
// classifies a server write-refusal into an actionable message (CAPABILITIES §2).

import { z } from "zod";
import { buildSetMetadataArgs, isAllowedField } from "../calibre/metadata-fields.js";
import type { ChangeValue } from "../calibre/metadata-fields.js";
import { CalibreCliError } from "../domain/errors.js";
import type { Book } from "../domain/book.js";
import { BookId, jsonRecord } from "./coerce.js";
import { defineTool } from "./define.js";
import { resolveNumericId } from "./resolve-id.js";
import { toolError, toolOk } from "./result.js";

// One field's new value: scalar, multi-value list, or identifiers map. -32602-hardened
// via jsonRecord (the whole `changes` object may arrive as a JSON string).
const ChangeValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
]);

/** Read a Book's value for a calibre field name (custom #columns aren't on Book → undefined). */
function bookFieldValue(book: Book, field: string): unknown {
  switch (field) {
    case "title": return book.title;
    case "authors": return book.authors;
    case "tags": return book.tags;
    case "series": return book.series;
    case "series_index": return book.seriesIndex;
    case "rating": return book.rating;
    case "publisher": return book.publisher;
    case "pubdate": return book.pubdate;
    case "languages": return book.languages;
    case "comments": return book.comments;
    case "identifiers": return book.identifiers;
    default: return undefined;
  }
}

const WRITE_REFUSED = /forbidden|unauthorized|\b401\b|\b403\b/i;

export const updateBookTool = defineTool({
  name: "calibre_update_book",
  title: "Update book metadata",
  description:
    "Replace metadata fields on one book (title, authors, tags, series, rating, identifiers, comments, or any #custom column). Omitted fields are untouched. Requires writes to be enabled.",
  inputSchema: {
    id: BookId(),
    changes: jsonRecord(ChangeValueSchema),
    library: z.string().optional(),
  },
  outputSchema: {
    id: z.number().optional(),
    changed: z
      .array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() }))
      .optional(),
    noop: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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

      const numericId = await resolveNumericId(deps, args.id, args.library);
      if (numericId === undefined) return toolError(`No book with id/uuid ${args.id}`);

      const before = await deps.content.getBook(numericId, args.library);

      try {
        await deps.calibre.calibredb(buildSetMetadataArgs(numericId, changes), {
          library: args.library,
        });
      } catch (err) {
        if (err instanceof CalibreCliError && WRITE_REFUSED.test(err.stderr ?? "")) {
          return toolError(
            "Calibre refused the write. Anonymous writes are blocked — restart the Content Server " +
              "with --enable-local-write (localhost), or configure an authenticated non-restricted user. " +
              "See docs/CAPABILITIES.md §2.",
          );
        }
        throw err;
      }

      const after = await deps.content.getBook(numericId, args.library);
      const changed = fields.map((field) => ({
        field,
        before: bookFieldValue(before, field),
        after: bookFieldValue(after, field),
      }));
      const noop = changed.every((c) => JSON.stringify(c.before) === JSON.stringify(c.after));

      const summary = noop
        ? `No changes applied to book ${numericId} (values already current).`
        : `Updated book ${numericId}: ${fields.join(", ")}.`;
      return toolOk([{ type: "text", text: summary }], { id: numericId, changed, noop });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
  },
});
