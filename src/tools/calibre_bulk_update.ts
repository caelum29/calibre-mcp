// calibre_bulk_update (#12) — apply the SAME metadata changes to a SET of books. Gated write.
// Preview-first by default (computes a per-book diff WITHOUT writing); a book set is REQUIRED
// (ids or a non-empty query — never an all-books default, the FaceDeer anti-pattern we fix).
// Applies by looping `calibredb set_metadata` per book (no bulk CLI form; HTTP batch is LATER).

import { z } from "zod";
import { buildSetMetadataArgs } from "../calibre/metadata-fields.js";
import {
  caseRenameNotes,
  isAllowedField,
  listReplacementNote,
  previewBookChanges,
  sameItemName,
} from "../domain/book-fields.js";
import type { ChangeValue } from "../domain/book-fields.js";
import { CalibreCliTimeoutError } from "../domain/errors.js";
import { buildScopedQuery, honestyLines, resolveFilter } from "../app/bundles.js";
import { BookId, CoercedBool, jsonArray, jsonRecord, jsonStringList } from "./coerce.js";
import { defineTool } from "./define.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ToolResult } from "./types.js";
import { selectBooks } from "../app/select-books.js";
import { ChangeValueSchema } from "./calibre_update_book.js";
import {
  isWriteRefused,
  WRITE_REFUSED_MESSAGE,
  classifyTransient,
  describeTransient,
  withTransientRetry,
  verifyTimedOutWrite,
} from "../app/write-policy.js";
import { errorCodeFor } from "../domain/error-codes.js";
import { mergeTags, type TagMerge } from "../domain/tag-ops.js";
import { resolveTagSpellings } from "../app/tag-spelling.js";

/** Hard cap on books mutated in one call — a bulk write must be a deliberate, bounded set. */
const MAX_BULK = 500;

export const bulkUpdateTool = defineTool({
  name: "calibre_bulk_update",
  title: "Bulk update book metadata",
  description:
    "Apply the same metadata changes (tags, series, publisher, etc.) to a set of books selected " +
    "by ids, a search query, or filter (a bundle name). Preview-first: returns the per-book diff " +
    "without writing unless preview is set false. A book set is required (never all books). " +
    "A list in changes replaces the whole list; to add or remove tags while keeping the rest, use " +
    "tags_add / tags_remove (merged per book, case-insensitive, not together with changes.tags). " +
    "Requires writes to be enabled.",
  inputSchema: {
    changes: jsonRecord(ChangeValueSchema).optional(),
    tags_add: jsonStringList(),
    tags_remove: jsonStringList(),
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
          // tags_add / tags_remove calls: how many tags this book gains and loses
          tagsAdded: z.number().optional(),
          tagsRemoved: z.number().optional(),
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
      const changes = (args.changes ?? {}) as Record<string, ChangeValue>;
      const fields = Object.keys(changes);
      const tagsAdd = args.tags_add ?? [];
      const tagsRemove = args.tags_remove ?? [];
      const tagOps = tagsAdd.length > 0 || tagsRemove.length > 0;
      if (fields.length === 0 && !tagOps) {
        return toolError("invalid_input", "Provide at least one field in changes, or tags_add/tags_remove.");
      }
      // Calibre splits a tag value on commas, so "a,b" would preview as one tag and land as two.
      const comma = [...tagsAdd, ...tagsRemove].find((t) => t.includes(","));
      if (comma !== undefined) {
        return toolError(
          "invalid_input",
          `Tag "${comma}" contains a comma; Calibre splits tags on commas. Pass each tag as its own entry.`,
        );
      }
      // one tags value per book: a full replacement and a merge can't both apply
      if (tagOps && "tags" in changes) {
        return toolError(
          "invalid_input",
          "Pass tags either as changes.tags (replaces the whole list) or as tags_add/tags_remove " +
            "(merges per book), not both.",
        );
      }

      const unknown = fields.filter((f) => !isAllowedField(f));
      if (unknown.length > 0) {
        return toolError(
          "invalid_input",
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
          "invalid_input",
          "Select a book set: pass ids, a non-empty query, or filter (a bundle name) — all-books is not allowed.",
        );
      }
      // ids are an exact set; combining them with a query/filter would silently drop one side (#214)
      if (hasIds && (hasQuery || hasFilter)) {
        return toolError("invalid_input", "Pass either ids or query/filter, not both.");
      }
      const fr = await resolveFilter(deps, { filter: args.filter, autoExclude: false, library: args.library });
      if (!fr.ok)
        return fr.cause === undefined ? toolError("not_found", fr.error) : toolError(errorCodeFor(fr.cause), fr.error);

      const selection = await selectBooks(deps, {
        ids: hasIds ? args.ids : undefined,
        query: hasIds ? undefined : buildScopedQuery(hasQuery ? (args.query as string) : "", fr.res) || undefined,
        library: args.library,
      });
      if (selection.books.length === 0) return toolError("not_found", "No books matched the selection.");
      if (selection.capped || selection.books.length > MAX_BULK) {
        return toolError(
          "invalid_input",
          `Selection too large (${selection.total}); the bulk write cap is ${MAX_BULK}. ` +
            `Narrow the query or pass explicit ids.`,
        );
      }

      // An added tag takes the library's spelling: a new case would rename it on every book.
      // A tag that is also removed never lands, so it needs no lookup.
      let added: string[] = [];
      if (tagOps) {
        const toAdd = tagsAdd.filter((t) => !tagsRemove.some((r) => sameItemName(r, t)));
        try {
          added = await resolveTagSpellings(
            deps,
            toAdd,
            selection.books.flatMap((b) => b.tags),
            args.library,
          );
        } catch (err) {
          return toolError(
            errorCodeFor(err),
            `Couldn't check the library's existing tag spellings (${err instanceof Error ? err.message : String(err)}). ` +
              "Nothing was written; retry the call.",
          );
        }
      }
      const perBook = selection.books.map((b) => {
        const merge: TagMerge | undefined = tagOps ? mergeTags(b.tags, added, tagsRemove) : undefined;
        // per-book changes: the merged tags differ per book; verify checks this, not the raw params
        const bookChanges = merge ? { ...changes, tags: merge.tags } : changes;
        return {
          id: b.id,
          title: b.title,
          changes: bookChanges,
          merge,
          diff: previewBookChanges(b, bookChanges),
          book: b, // before-snapshot, needed to verify an ambiguous (timed-out) write
        };
      });

      // Preview (default): show the diff, write nothing.
      if (args.preview) {
        const lines = perBook.map((b) => {
          const merged = (field: string): TagMerge | undefined => (field === "tags" ? b.merge : undefined);
          const parts = b.diff.map((d) => {
            const m = merged(d.field);
            const counts = m && d.changed ? ` (+${m.added} added, ${m.removed} removed)` : "";
            return (
              `  ${d.field}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}` +
              (d.changed ? counts : " (no change)")
            );
          });
          // a list set replaces the whole list — say so in text, where a one-item set is easy to miss
          // (not for a tags merge, which keeps what it doesn't remove) — and a case-only edit of a
          // tag/author renames the shared item on every book
          const flags = b.diff
            .flatMap((d) =>
              [merged(d.field) ? undefined : listReplacementNote(d), ...caseRenameNotes(d)].filter(
                (n): n is string => !!n,
              ),
            )
            .map((n) => `  ⚠ ${n}`);
          return `#${b.id} ${b.title}\n${[...parts, ...flags].join("\n")}`;
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
            ...(b.merge ? { tagsAdded: b.merge.added, tagsRemoved: b.merge.removed } : {}),
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
            () => deps.calibre.calibredb(buildSetMetadataArgs(b.id, b.changes), { library: libId }),
            deps.sleep,
          );
          applied.push(b.id);
        } catch (err) {
          // A refusal blocks every later write too, so stop — but once books have committed,
          // they must stay visible or the model retries the whole set (#33, #213).
          if (isWriteRefused(err)) {
            if (applied.length === 0) return toolError("write_refused", WRITE_REFUSED_MESSAGE);
            failed.push({ id: b.id, error: WRITE_REFUSED_MESSAGE });
            return stoppedMidLoop(
              { matched: perBook.length, applied, failed, notAttempted: perBook.slice(i + 1).map((p) => p.id) },
              {
                headline: "Calibre refused the write",
                steer: `${WRITE_REFUSED_MESSAGE} After fixing the server`,
                err,
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
                err,
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
              changes: b.changes,
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
        `Applied ${(tagOps ? [...fields, "tags"] : fields).join(", ")} to ${applied.length}/${perBook.length} book(s).` +
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
      return toolError(errorCodeFor(err), err instanceof Error ? err.message : String(err));
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
  /** The failure that stopped the loop — its code is the result's errorCode (#249). */
  err: unknown;
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
  return toolError(errorCodeFor(cause.err), text, {
    structured: { preview: false, matched, applied, failed, notAttempted, retryIds },
  });
}
