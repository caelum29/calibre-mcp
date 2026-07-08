// calibre_update_book — the first gated WRITE tool. Sets metadata fields on one book via
// `calibredb set_metadata`, routed through the Content Server URL (GUI-safe). Disabled
// unless CALIBRE_MCP_ENABLE_WRITE is on (server.ts gate). Reports an applied diff and
// classifies a server write-refusal into an actionable message (CAPABILITIES §2).

import { z } from "zod";
import { bookFieldValue, buildSetMetadataArgs, isAllowedField } from "../calibre/metadata-fields.js";
import type { ChangeValue } from "../calibre/metadata-fields.js";
import { BookId, jsonRecord } from "./coerce.js";
import { defineTool } from "./define.js";
import { bookIdArg, resolveNumericId } from "./resolve-id.js";
import { toolError, toolOk } from "./result.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "./write-refusal.js";

// One field's new value: scalar, multi-value list, or identifiers map. -32602-hardened
// via jsonRecord (the whole `changes` object may arrive as a JSON string).
export const ChangeValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
]);

export const updateBookTool = defineTool({
  name: "calibre_update_book",
  title: "Update book metadata",
  description:
    "Replace metadata fields on one book (title, authors, tags, series, rating, identifiers, comments, or any #custom column). Omitted fields are untouched. Requires writes to be enabled.",
  inputSchema: {
    id: BookId().optional(),
    bookId: BookId().optional(),
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

      const idArg = bookIdArg(args);
      if (idArg === undefined) return toolError("Provide id (the book's db id or uuid).");
      const numericId = await resolveNumericId(deps, idArg, args.library);
      if (numericId === undefined) return toolError(`No book with id/uuid ${idArg}`);

      const before = await deps.content.getBook(numericId, args.library);

      // calibredb --with-library needs the library ID (e.g. "Programming_Books"), not the
      // display name — resolve it, or the routed write 404s ("Not Found") against the server.
      const libId = await deps.content.resolveLibraryId(args.library);

      try {
        await deps.calibre.calibredb(buildSetMetadataArgs(numericId, changes), {
          library: libId,
        });
      } catch (err) {
        if (isWriteRefused(err)) return toolError(WRITE_REFUSED_MESSAGE);
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
