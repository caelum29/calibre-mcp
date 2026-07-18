// calibre_update_book — the first gated WRITE tool. Sets metadata fields on one book via
// `calibredb set_metadata`, routed through the Content Server URL (GUI-safe). Disabled
// unless CALIBRE_MCP_ENABLE_WRITE is on (server.ts gate). Reports an applied diff and
// classifies a server write-refusal into an actionable message (CAPABILITIES §2).

import { z } from "zod";
import {
  bookFieldValue,
  buildSetMetadataArgs,
  changesSatisfied,
  isAllowedField,
} from "../calibre/metadata-fields.js";
import type { ChangeValue } from "../calibre/metadata-fields.js";
import type { Book } from "../domain/book.js";
import { CalibreCliTimeoutError } from "../domain/errors.js";
import { BookId, jsonRecord } from "./coerce.js";
import { defineTool } from "./define.js";
import type { ToolDeps, ToolResult } from "./types.js";
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
        // A routed write commits server-side BEFORE calibredb replies, so a timeout is
        // ambiguous — verify against a re-read instead of reporting failure (issue #33).
        if (err instanceof CalibreCliTimeoutError) {
          return confirmTimedOutWrite(deps, numericId, before, changes, args.library);
        }
        throw err;
      }

      // Committed. Nothing below may turn the result into an error (issue #33): a failed
      // diff re-read degrades to success-without-verified-diff, never to isError.
      let after: Book;
      try {
        after = await deps.content.getBook(numericId, args.library);
      } catch {
        const changed = fields.map((field) => ({
          field,
          before: bookFieldValue(before, field),
          after: changes[field],
        }));
        return toolOk(
          [
            {
              type: "text",
              text:
                `Updated book ${numericId}: ${fields.join(", ")}. ` +
                `(diff shows intended values — the verification re-read failed)`,
            },
          ],
          { id: numericId, changed, noop: false },
        );
      }
      return appliedResult(numericId, before, after, fields);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
  },
});

/** Build the normal success result: per-field before/after diff + noop detection. */
function appliedResult(id: number, before: Book, after: Book, fields: string[]): ToolResult {
  const changed = fields.map((field) => ({
    field,
    before: bookFieldValue(before, field),
    after: bookFieldValue(after, field),
  }));
  const noop = changed.every((c) => JSON.stringify(c.before) === JSON.stringify(c.after));
  const summary = noop
    ? `No changes applied to book ${id} (values already current).`
    : `Updated book ${id}: ${fields.join(", ")}.`;
  return toolOk([{ type: "text", text: summary }], { id, changed, noop });
}

/**
 * The write TIMED OUT client-side but may have committed server-side. Re-read the book:
 * if every requested field landed, report success (never fail a committed write — issue
 * #33); otherwise return an error that steers the model to check before retrying.
 */
async function confirmTimedOutWrite(
  deps: ToolDeps,
  id: number,
  before: Book,
  changes: Record<string, ChangeValue>,
  library?: string,
): Promise<ToolResult> {
  let after: Book;
  try {
    after = await deps.content.getBook(id, library);
  } catch {
    return toolError(
      `calibredb timed out and the book could not be re-read to verify. The write MAY ` +
        `have been applied — check with calibre_get_book id=${id} before retrying.`,
    );
  }
  if (changesSatisfied(before, after, changes)) {
    return appliedResult(id, before, after, Object.keys(changes));
  }
  return toolError(
    `calibredb timed out and a re-read does not show the changes applied. Retry, or check ` +
      `with calibre_get_book id=${id} first.`,
  );
}
