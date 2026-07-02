// calibre_extract_isbn (#15) — the kiwidude Extract-ISBN capability. Scans a book's own text
// (front matter) for a checksum-valid ISBN and stamps it into identifiers:isbn. Clean-room:
// the scan reuses our own extractIsbns/scanForIsbn (not a port of the GPL plugin). Gated WRITE,
// preview-first: returns what it found without writing unless apply=true. Merges into existing
// identifiers so a doi/asin/etc. is never clobbered (set_metadata replaces the whole map).

import { z } from "zod";
import { buildSetMetadataArgs } from "../calibre/metadata-fields.js";
import { isValidIsbn } from "../domain/curation/isbn.js";
import { BookId, CoercedBool } from "./coerce.js";
import { defineTool } from "./define.js";
import { scanForIsbn, scanOutcomeHint } from "./isbn-scan.js";
import { resolveNumericId } from "./resolve-id.js";
import { toolError, toolOk } from "./result.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "./write-refusal.js";

export const extractIsbnTool = defineTool({
  name: "calibre_extract_isbn",
  title: "Extract ISBN from book text",
  description:
    "Scan a book's own text (front matter) for a valid ISBN and set it as the book's isbn " +
    "identifier. Preview-first: reports the ISBN found without writing unless apply is true. " +
    "Merges into existing identifiers (never clobbers doi/asin). Requires writes to be enabled.",
  inputSchema: {
    id: BookId(),
    apply: CoercedBool().default(false),
    library: z.string().optional(),
  },
  outputSchema: {
    bookId: z.number().optional(),
    isbn: z.string().optional(),
    currentIsbn: z.string().optional(),
    changed: z.boolean().optional(),
    applied: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  write: true,
  handler: async (args, deps) => {
    try {
      const numericId = await resolveNumericId(deps, args.id, args.library);
      if (numericId === undefined) return toolError(`No book with id/uuid ${args.id}`);
      const book = await deps.content.getBook(numericId, args.library);

      const currentIsbn =
        book.identifiers.isbn && isValidIsbn(book.identifiers.isbn) ? book.identifiers.isbn : undefined;

      const scan = await scanForIsbn(deps, book, numericId, args.library);
      deps.log.debug("extract_isbn scan", { bookId: numericId, outcome: scan.outcome });

      if (!scan.isbn) {
        return toolError(
          `No ISBN extracted from book ${numericId} ("${book.title}"): ${scanOutcomeHint(scan.outcome)}.`,
        );
      }

      const isbn = scan.isbn;
      const changed = isbn !== currentIsbn;

      // Preview (default): report the find, write nothing.
      if (!args.apply) {
        const status = !currentIsbn
          ? "no ISBN is set"
          : changed
            ? `current isbn is ${currentIsbn}`
            : "this matches the current isbn";
        const text = changed
          ? `Found ISBN ${isbn} in book #${numericId} text (${status}). ` +
            `Re-run with apply=true to write identifiers:isbn.`
          : `Book #${numericId} already has isbn ${isbn} (${status}); nothing to write.`;
        return toolOk([{ type: "text", text }], {
          bookId: numericId,
          isbn,
          currentIsbn,
          changed,
          applied: false,
        });
      }

      // No-op guard: the found ISBN already matches, so skip the round-trip.
      if (!changed) {
        return toolOk(
          [{ type: "text", text: `Book #${numericId} already has isbn ${isbn}; no change.` }],
          { bookId: numericId, isbn, currentIsbn, changed: false, applied: false },
        );
      }

      // Apply: merge into the existing identifiers so set_metadata (which replaces the whole
      // map) doesn't drop a doi/asin/etc. calibredb needs the library ID, not the display name.
      const merged = { ...book.identifiers, isbn };
      const libId = await deps.content.resolveLibraryId(args.library);
      try {
        await deps.calibre.calibredb(buildSetMetadataArgs(numericId, { identifiers: merged }), {
          library: libId,
        });
      } catch (err) {
        if (isWriteRefused(err)) return toolError(WRITE_REFUSED_MESSAGE);
        throw err;
      }

      const summary = currentIsbn
        ? `Set isbn ${isbn} on book #${numericId} (was ${currentIsbn}).`
        : `Set isbn ${isbn} on book #${numericId}.`;
      return toolOk([{ type: "text", text: summary }], {
        bookId: numericId,
        isbn,
        currentIsbn,
        changed: true,
        applied: true,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});
