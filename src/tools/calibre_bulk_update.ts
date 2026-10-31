// calibre_bulk_update (#12) — apply the SAME metadata changes to a SET of books. Gated write.
// Preview-first by default (computes a per-book diff WITHOUT writing); a book set is REQUIRED
// (ids or a non-empty query — never an all-books default, the FaceDeer anti-pattern we fix).
// Applies by looping `calibredb set_metadata` per book (no bulk CLI form; HTTP batch is LATER).

import { z } from "zod";
import { buildSetMetadataArgs } from "../calibre/metadata-fields.js";
import { isAllowedField, previewBookChanges } from "../domain/book-fields.js";
import type { ChangeValue } from "../domain/book-fields.js";
import { CalibreCliTimeoutError } from "../domain/errors.js";
import { buildScopedQuery, honestyLines, resolveFilter } from "./bundles.js";
import { BookId, CoercedBool, jsonArray, jsonRecord } from "./coerce.js";
import { defineTool } from "./define.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ToolResult } from "./types.js";
import { selectBooks } from "./select-books.js";
import { ChangeValueSchema } from "./calibre_update_book.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "./write-refusal.js";
import { classifyTransient, describeTransient, withTransientRetry } from "./write-retry.js";
import { verifyTimedOutWrite } from "./write-verify.js";

/** Hard cap on books mutated in one call — a bulk write must be a deliberate, bounded set. */
const MAX_BULK = 500;

export const bulkUpdateTool = defineTool({
  name: "calibre_bulk_update",
  title: "Bulk update book metadata",
  description:
    "Apply the same metadata changes (tags, series, publisher, etc.) to a set of books selected " +
    "by ids, a search query, or filter (a bundle name). Preview-first: returns the per-book diff " +
    "without writing unless preview is set false. A book set is required (never all books). " +
    "Requires writes to be enabled.",
  inputSchema: {
    changes: jsonRecord(ChangeValueSchema),
    ids: jsonArray(BookId()).optional(),
    query: z.string().optional(),
    filter: z.string().trim().min(1).max(256).optional(),
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
    notAttempted: z.array(z.number()).optional(),
    retryIds: z.array(z.number()).optional(),
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
      // A bundle filter counts: it is a bounded, named set (#93). No auto-exclusion on writes.
      const hasIds = Array.isArray(args.ids) && args.ids.length > 0;
      const hasQuery = typeof args.query === "string" && args.query.trim().length > 0;
      const hasFilter = args.filter !== undefined;
      if (!hasIds && !hasQuery && !hasFilter) {
        return toolError(
          "Select a book set: pass ids, a non-empty query, or filter (a bundle name) — all-books is not allowed.",
        );
      }
      // ids are an exact set; combining them with a query/filter would silently drop one side (#214)
      if (hasIds && (hasQuery || hasFilter)) {
        return toolError("Pass either ids or query/filter, not both.");
      }
      const fr = await resolveFilter(deps, { filter: args.filter, autoExclude: false, library: args.library });
      if (!fr.ok) return toolError(fr.error);

      const selection = await selectBooks(deps, {
        ids: hasIds ? args.ids : undefined,
        query: hasIds ? undefined : buildScopedQuery(hasQuery ? (args.query as string) : "", fr.res) || undefined,
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
        book: b, // before-snapshot, needed to verify an ambiguous (timed-out) write
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
        const honesty = honestyLines(fr.res, hasFilter && !hasQuery ? selection.total : undefined);
        const text =
          (honesty.length ? `${honesty.join("\n")}\n` : "") +
          `Preview — ${selection.books.length} book(s) selected, ${changing} would change. ` +
          `Re-run with preview=false to apply.\n` +
          fence("BULK UPDATE PREVIEW", lines.join("\n\n"));
        return toolOk([{ type: "text", text }], {
          preview: true,
          matched: selection.books.length,
          books: perBook.map((b) => ({
            id: b.id,
            title: b.title,
            // null, not undefined: a previously-empty field must keep its required `before` key
            changed: b.diff.map(({ field, before, after }) => ({
              field,
              before: before ?? null,
              after: after ?? null,
            })),
          })),
        });
      }

      // Apply: resolve the library ID once (calibredb needs the ID, not the display name), then
      // loop set_metadata per book. Per-book failures are collected, not fatal.
      const libId = await deps.content.resolveLibraryId(args.library);
      const applied: number[] = [];
      const failed: { id: number; error: string }[] = [];
      for (const [i, b] of perBook.entries()) {
        try {
          // set_metadata is idempotent, so transient failures are retried in place (#233)
          await withTransientRetry(
            () => deps.calibre.calibredb(buildSetMetadataArgs(b.id, changes), { library: libId }),
            deps.sleep,
          );
          applied.push(b.id);
        } catch (err) {
          // A refusal blocks every later write too, so stop — but once books have committed,
          // they must stay visible or the model retries the whole set (#33, #213).
          if (isWriteRefused(err)) {
            if (applied.length === 0) return toolError(WRITE_REFUSED_MESSAGE);
            failed.push({ id: b.id, error: WRITE_REFUSED_MESSAGE });
            return stoppedMidLoop(
              { matched: perBook.length, applied, failed, notAttempted: perBook.slice(i + 1).map((p) => p.id) },
              {
                headline: "Calibre refused the write",
                steer: `${WRITE_REFUSED_MESSAGE} After fixing the server`,
              },
            );
          }
          // Retries exhausted. A down server fails every later book the same way, so this is a
          // circuit breaker (stop like a refusal); a gateway 5xx fails only this book (#233).
          const transient = classifyTransient(err);
          if (transient === "connection") {
            failed.push({ id: b.id, error: describeTransient(err, b.id) });
            return stoppedMidLoop(
              { matched: perBook.length, applied, failed, notAttempted: perBook.slice(i + 1).map((p) => p.id) },
              {
                headline: "Stopped: the Calibre Content Server is unreachable",
                steer: `${describeTransient(err, b.id)} Once it is back`,
              },
            );
          }
          if (transient === "server") {
            failed.push({ id: b.id, error: describeTransient(err, b.id) });
            continue;
          }
          // Timed-out routed writes may have committed server-side — re-read and count
          // the book as applied when every requested field landed (issue #33).
          if (err instanceof CalibreCliTimeoutError) {
            const check = await verifyTimedOutWrite(deps, {
              id: b.id,
              before: b.book,
              changes,
              library: args.library,
            });
            if (check.status === "landed") {
              applied.push(b.id);
              continue;
            }
            failed.push({
              id: b.id,
              error:
                "calibredb timed out and a re-read does not confirm the change — " +
                `verify with calibre_get_book id=${b.id} before retrying`,
            });
            continue;
          }
          failed.push({ id: b.id, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const summary =
        `Applied ${fields.join(", ")} to ${applied.length}/${perBook.length} book(s).` +
        // on a partial run name the committed ids, so a retry skips them (#227)
        (failed.length > 0 && applied.length > 0 ? ` Committed: ${applied.join(", ")}.` : "") +
        (failed.length > 0 ? ` ${failed.length} failed: ${failed.map((f) => f.id).join(", ")}.` : "") +
        // one line per failure, so text-only clients still see each reason and #33 steer (#216)
        failed.map((f) => `\n#${f.id}: ${oneLine(f.error)}`).join("");
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

/** Longest per-id error shown in text; the full message stays in structuredContent. */
const MAX_ERROR_TEXT = 200;

/**
 * Collapse raw calibredb stderr (tracebacks, multi-line) to one bounded line, so each
 * failed id keeps exactly one `#id:` line in the text (#216).
 */
function oneLine(error: string): string {
  const s = error.replace(/\s+/g, " ").trim();
  return s.length > MAX_ERROR_TEXT ? `${s.slice(0, MAX_ERROR_TEXT - 1)}…` : s;
}

/** Why the loop stopped: the lead-in sentence and the fix-it steer before the re-run hint. */
interface StopCause {
  headline: string;
  steer: string;
}

/**
 * Partial result for a loop stopped by the server (a refusal after ≥1 commit, or the #233
 * circuit breaker): still `isError` (the run did not finish), but the committed ids lead the
 * text so the model retries only the rest.
 */
function stoppedMidLoop(
  run: { matched: number; applied: number[]; failed: { id: number; error: string }[]; notAttempted: number[] },
  cause: StopCause,
): ToolResult {
  const { matched, applied, failed, notAttempted } = run;
  // The refused book (last in `failed`) and the unattempted ones are blocked only by the server;
  // earlier per-book failures had their own reasons, so they aren't part of the re-run.
  const refusedId = failed.at(-1)?.id;
  const retryIds = refusedId === undefined ? notAttempted : [refusedId, ...notAttempted];
  const text =
    `${cause.headline} after ${applied.length}/${matched} book(s) were already updated. ` +
    (applied.length > 0 ? `Already committed: ${applied.join(", ")}. ` : "") +
    `Failed: ${failed.map((f) => f.id).join(", ")}. ` +
    (notAttempted.length > 0 ? `Not attempted: ${notAttempted.join(", ")}. ` : "") +
    // writes are idempotent sets, so re-running is safe; naming the ids saves the model the set math
    `${cause.steer}, re-run with ids=[${retryIds.join(",")}].`;
  return toolError(text, { preview: false, matched, applied, failed, notAttempted, retryIds });
}
