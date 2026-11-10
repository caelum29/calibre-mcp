// calibre_bulk_update (#12) — apply the SAME metadata changes to a SET of books. Gated write.
// Preview-first by default (computes a per-book diff WITHOUT writing); a book set is REQUIRED
// (ids or a non-empty query — never an all-books default, the FaceDeer anti-pattern we fix).
// Applies by looping `calibredb set_metadata` per book (no bulk CLI form; HTTP batch is LATER).

import { filterErrorText } from "./writes-remedy.js";
import { writeStep } from "./writes-remedy.js";
import { z } from "zod";
import { buildSetMetadataArgs, formatFieldValue } from "../calibre/metadata-fields.js";
import {
  caseRenameNotes,
  isAllowedField,
  listReplacementNote,
  previewBookChanges,
  sameItemName,
} from "../domain/book-fields.js";
import type { ChangeValue, FieldDiff } from "../domain/book-fields.js";
import { buildScopedQuery, honestyLines, resolveFilter } from "../app/bundles.js";
import { BookId, CoercedBool, jsonArray, jsonRecord, jsonStringList } from "./coerce.js";
import { defineTool } from "./define.js";
import { fence, toolError, toolOk, toolErrorFrom, errorFromCatch } from "./result.js";
import type { ToolResult } from "./types.js";
import type { Book } from "../domain/book.js";
import { selectBooks } from "../app/select-books.js";
import { ChangeValueSchema } from "./calibre_update_book.js";
import {
  WRITE_REFUSED_MESSAGE,
  classifyTransient,
  describeTransient,
  withTransientRetry,
  settleFailedWrite,
  type FailedWriteOutcome,
  foreignNote,
  type ReReadCause,
} from "../app/write-policy.js";
import { presentFailedWrite } from "./write-failure.js";
import { errorCodeFor, type ErrorCode } from "../domain/error-codes.js";
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
    "Previews work without writes; applying needs CALIBRE_MCP_ENABLE_WRITE.",
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
          // preview: list-replacement and case-rename warnings, same strings as the ⚠ text lines
          warnings: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    applied: z.array(z.number()).optional(),
    // tags_add / tags_remove calls: books skipped because the merge changed nothing (#333)
    unchanged: z.array(z.number()).optional(),
    // books whose write only a re-read confirmed (connection dropped / calibredb timed out) (#370)
    confirmedByReRead: z.array(z.object({ id: z.number(), cause: z.enum(["dropped", "timeout"]) })).optional(),
    failed: z.array(z.object({ id: z.number(), error: z.string() })).optional(),
    notAttempted: z.array(z.number()).optional(),
    retryIds: z.array(z.number()).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  write: true,
  writeCall: (args) => !args.preview,
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

      // reject malformed values up front: otherwise the preview shows them and apply fails per book (#421)
      for (const [field, value] of Object.entries(changes)) formatFieldValue(field, value);

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
      if (!fr.ok) return toolErrorFrom(fr.cause, filterErrorText(fr, deps.config.writeEnabled));

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
      const planBook = (b: Book) => {
        const merge: TagMerge | undefined = tagOps ? mergeTags(b.tags, added, tagsRemove) : undefined;
        // per-book changes: the merged tags differ per book; verify checks this, not the raw params
        const bookChanges = merge ? { ...changes, tags: merge.tags } : changes;
        const diff = previewBookChanges(b, bookChanges);
        return {
          id: b.id,
          title: b.title,
          changes: bookChanges,
          merge,
          diff,
          warnings: previewWarnings(diff, merge !== undefined),
          book: b, // before-snapshot, needed to verify an ambiguous (timed-out) write
        };
      };
      const perBook = selection.books.map(planBook);

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
          const flags = b.warnings.map((n) => `  ⚠ ${n}`);
          return `#${b.id} ${b.title}\n${[...parts, ...flags].join("\n")}`;
        });
        const changing = perBook.filter((b) => b.diff.some((d) => d.changed)).length;
        const honesty = honestyLines(fr.res, hasFilter && !hasQuery ? selection.total : undefined);
        const text =
          (honesty.length ? `${honesty.join("\n")}\n` : "") +
          `Preview — ${selection.books.length} book(s) selected, ${changing} would change. ` +
          writeStep(deps.config.writeEnabled, "Re-run with preview=false to apply.", "Applying it") +
          "\n" +
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
            // the ⚠ lines of the text, for clients that read only structuredContent (#370)
            ...(b.warnings.length > 0 ? { warnings: b.warnings } : {}),
          })),
        });
      }

      // Apply: resolve the library ID once (calibredb needs the ID, not the display name), then
      // loop set_metadata per book. Per-book failures are collected, not fatal.
      const libId = await deps.content.resolveLibraryId(args.library);
      const applied: number[] = [];
      const failed: { id: number; error: string }[] = [];
      // tags-ops calls only: books whose merge changes nothing are skipped, not written (#333)
      const unchanged: number[] | undefined = tagOps ? [] : undefined;
      // books we only know landed because a re-read confirmed them (#370)
      const confirmed: Confirmed[] = [];
      const isNoop = (p: { diff: FieldDiff[] }) => p.diff.every((d) => !d.changed);
      for (const [i, planned] of perBook.entries()) {
        let b = planned;
        // a no-op merge needs no set_metadata — but the selection snapshot may be stale (a GUI
        // edit since), so decide on a fresh read; if that fails, write as before (#380 review)
        if (unchanged && isNoop(b)) {
          const fresh = await deps.content.getBook(b.id, args.library).catch(() => undefined);
          const replanned = fresh ? planBook(fresh) : b;
          if (fresh && isNoop(replanned)) {
            unchanged.push(b.id);
            continue;
          }
          b = replanned;
        }
        try {
          // set_metadata is idempotent, so transient failures are retried in place (#233)
          await withTransientRetry(
            () => deps.calibre.calibredb(buildSetMetadataArgs(b.id, b.changes), { library: libId }),
            deps.sleep,
          );
          applied.push(b.id);
        } catch (err) {
          const run = {
            matched: perBook.length,
            applied,
            unchanged,
            confirmed,
            failed,
            notAttempted: perBook.slice(i + 1).map((p) => p.id),
          };
          // a drop on ANY attempt or a timeout may have committed: the outcome comes from a re-read (#370)
          const outcome = await settleFailedWrite(
            deps,
            { id: b.id, before: b.book, changes: b.changes, library: args.library },
            err,
          );
          const stop = settleBook(outcome, b.id, err, run);
          if (stop) return stop;
        }
      }

      const summary =
        `Applied ${(tagOps ? [...fields, "tags"] : fields).join(", ")} to ${applied.length}/${perBook.length} book(s).` +
        unchangedText(unchanged) +
        confirmedText(confirmed) +
        // on a partial run name the committed ids, so a retry skips them (#227)
        (failed.length > 0 && applied.length > 0 ? ` Committed: ${applied.join(", ")}.` : "") +
        (failed.length > 0 ? ` ${failed.length} failed: ${failed.map((f) => f.id).join(", ")}.` : "") +
        // one line per failure, so text-only clients still see each reason and #33 steer (#216)
        failed.map((f) => `\n#${f.id}: ${oneLine(f.error)}`).join("");
      return toolOk([{ type: "text", text: summary }], {
        preview: false,
        matched: perBook.length,
        applied,
        ...(unchanged ? { unchanged } : {}),
        ...(confirmed.length > 0 ? { confirmedByReRead: confirmed } : {}),
        failed,
      });
    } catch (err) {
      return errorFromCatch(err);
    }
  },
});

/**
 * A book's preview warnings. A list set replaces the whole list — easy to miss for a one-item set
 * (not for a tags merge, which keeps what it doesn't remove) — and a case-only edit of a
 * tag/author renames the shared item on every book.
 */
function previewWarnings(diff: FieldDiff[], tagsMerged: boolean): string[] {
  return diff.flatMap((d) =>
    [tagsMerged && d.field === "tags" ? undefined : listReplacementNote(d), ...caseRenameNotes(d)].filter(
      (n): n is string => !!n,
    ),
  );
}

/** A book a re-read confirmed, and why a re-read was needed. */
interface Confirmed {
  id: number;
  cause: ReReadCause;
}

const CAUSE_TEXT: Record<ReReadCause, string> = { dropped: "connection dropped", timeout: "timed out" };

/** ` Confirmed by a re-read: 2 (connection dropped), 4 (timed out).` — "" when there are none. */
function confirmedText(confirmed: Confirmed[]): string {
  if (confirmed.length === 0) return "";
  return ` Confirmed by a re-read: ${confirmed.map((c) => `${c.id} (${CAUSE_TEXT[c.cause]})`).join(", ")}.`;
}

/** ` Already current (nothing written): 2, 5.` — the books a tags merge left as they were (#333). */
function unchangedText(unchanged: number[] | undefined): string {
  return unchanged?.length ? ` Already current (nothing written): ${unchanged.join(", ")}.` : "";
}

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
  /** Overrides the code derived from `err` when the re-read decided the outcome (#370). */
  code?: ErrorCode;
}

/** Where the loop stood when the server stopped it. */
interface StoppedRun {
  matched: number;
  applied: number[];
  /** Tags-ops calls: books skipped because their merge changed nothing (#333). */
  unchanged?: number[];
  confirmed: Confirmed[];
  failed: { id: number; error: string }[];
  notAttempted: number[];
  /** The book the server blocked, re-run with the rest; undefined when it was confirmed written. */
  blockedId: number | undefined;
  /** A confirmed book the stop's steer already names, so the text doesn't name it twice. */
  namedInSteer?: number;
}

/**
 * Partial result for a loop stopped by the server (a refusal after ≥1 commit, or the #233
 * circuit breaker): still `isError` (the run did not finish), but the committed ids lead the
 * text so the model retries only the rest.
 */
function stoppedMidLoop(run: StoppedRun, cause: StopCause): ToolResult {
  const { matched, applied, unchanged, confirmed, failed, notAttempted, blockedId } = run;
  // The blocked book and the unattempted ones are held up only by the server; earlier
  // per-book failures had their own reasons, so they aren't part of the re-run.
  const retryIds = blockedId === undefined ? notAttempted : [blockedId, ...notAttempted];
  const rerun = `re-run with ids=[${retryIds.join(",")}]`;
  const text =
    `${cause.headline} after ${applied.length}/${matched} book(s) were already updated. ` +
    (applied.length > 0 ? `Already committed: ${applied.join(", ")}. ` : "") +
    (unchanged?.length ? `${unchangedText(unchanged).trim()} ` : "") +
    confirmedText(confirmed.filter((c) => c.id !== run.namedInSteer)).trimStart() +
    (confirmed.some((c) => c.id !== run.namedInSteer) ? " " : "") +
    // a confirmed drop can stop the loop with nothing failed yet
    (failed.length > 0 ? `Failed: ${failed.map((f) => f.id).join(", ")}. ` : "") +
    (notAttempted.length > 0 ? `Not attempted: ${notAttempted.join(", ")}. ` : "") +
    // writes are idempotent sets, so re-running is safe; naming the ids saves the model the set math
    `${cause.steer}, ${rerun}.`;
  const opts = {
    // the re-run is the stop's own next step, already in the text: no generic Next: line (#437)
    hint: rerun,
    structured: {
      preview: false,
      matched,
      applied,
      ...(unchanged ? { unchanged } : {}),
      ...(confirmed.length > 0 ? { confirmedByReRead: confirmed } : {}),
      failed,
      notAttempted,
      retryIds,
    },
  };
  return toolError(cause.code ?? errorCodeFor(cause.err), text, opts);
}

const UNREACHABLE_HEADLINE = "Stopped: the Calibre Content Server is unreachable";

/** The loop state a failed book is recorded into; {@link stoppedMidLoop} adds where it stopped. */
type LoopState = Omit<StoppedRun, "blockedId" | "namedInSteer">;

/**
 * Record a failed book's outcome into the loop state. Returns the stopped result when the rest
 * of the set can't go on — a refusal, or a connection-class failure (the #233 breaker) — and
 * `undefined` to keep looping.
 */
function settleBook(outcome: FailedWriteOutcome, id: number, err: unknown, run: LoopState): ToolResult | undefined {
  switch (outcome.kind) {
    case "confirmed":
      run.applied.push(id);
      run.confirmed.push({ id, cause: outcome.cause });
      return stopRemainingAfterConfirmedDrop(run, id, err);
    case "refusedAfterLanding":
      run.applied.push(id);
      run.confirmed.push({ id, cause: outcome.cause });
      return refusedAfterLanding(run, id, err);
    case "unverified":
    case "refusedUnverified":
      return unverifiedBook(outcome, run, id, err);
    case "refused":
      return refusedStop(run, id, err);
    case "transient": {
      const shown = presentFailedWrite(outcome, { id, err });
      run.failed.push({ id, error: shown.text });
      // a down server fails every later book the same way; a gateway 5xx fails only this one (#233)
      if (outcome.transient === "server") return undefined;
      return stoppedMidLoop(
        { ...run, blockedId: id },
        {
          headline: UNREACHABLE_HEADLINE,
          steer: `${describeTransient(err, id)} Once it is back`,
          err,
          code: shown.code,
        },
      );
    }
    case "unexpected":
      run.failed.push({ id, error: presentFailedWrite(outcome, { id, err }).text });
      return undefined;
  }
}

/**
 * A book the re-read could not confirm is failed with the verify steer. A timeout or a 5xx/500
 * tail fails only this book; a refusal or a connection-class tail stops the loop (#370).
 */
function unverifiedBook(
  outcome: Extract<FailedWriteOutcome, { kind: "unverified" | "refusedUnverified" }>,
  run: LoopState,
  id: number,
  err: unknown,
): ToolResult | undefined {
  const note = foreignNote(outcome.check);
  const failed = presentFailedWrite(outcome, {
    id,
    err,
    // a timeout words its steer for one book of many
    unconfirmed: (cause) => {
      if (cause !== "timeout") return undefined;
      const hint = `verify with calibre_get_book id=${id} before retrying`;
      return { text: `calibredb timed out and a re-read does not confirm the change — ${hint}.${note}`, hint };
    },
  });
  run.failed.push({ id, error: failed.text });
  // a timeout fails only this book; a drop continues below to the refusal / connection checks
  if (outcome.cause === "timeout") return undefined;
  if (outcome.kind === "refusedUnverified") {
    const steer = `${describeTransient(err, id)}${note} ${REFUSED_STEER}`;
    return stoppedMidLoop({ ...run, blockedId: id }, { headline: REFUSED_HEADLINE, steer, err, code: failed.code });
  }
  if (classifyTransient(err) !== "connection") return undefined;
  const steer = `${describeTransient(err, id)}${note} Once it is back`;
  return stoppedMidLoop({ ...run, blockedId: id }, { headline: UNREACHABLE_HEADLINE, steer, err, code: failed.code });
}

/** A confirmed drop whose final error is connection-class still trips the breaker for the rest. */
function stopRemainingAfterConfirmedDrop(run: LoopState, id: number, err: unknown): ToolResult | undefined {
  // a 5xx/500/timeout tail fails nothing more; a landed last book has nothing left to stop
  if (classifyTransient(err) !== "connection" || run.notAttempted.length === 0) return undefined;
  // confirmed written: the stop is about the server, not this write — don't steer to a re-check
  const steer = `The connection dropped mid-request, but a re-read confirmed book ${id} was written. Once the Content Server is back`;
  return stoppedMidLoop(
    { ...run, blockedId: undefined, namedInSteer: id },
    { headline: UNREACHABLE_HEADLINE, steer, err, code: "calibre_unreachable" },
  );
}

const REFUSED_HEADLINE = "Calibre refused the write";
const REFUSED_STEER = `${WRITE_REFUSED_MESSAGE} After fixing the server`;

/** A dropped write that landed before a refusal: the refusal still blocks the rest (#370). */
function refusedAfterLanding(run: LoopState, id: number, err: unknown): ToolResult | undefined {
  if (run.notAttempted.length === 0) return undefined; // nothing left for the refusal to block
  const steer = `A re-read confirmed book ${id} was written before the refusal. ${REFUSED_STEER}`;
  return stoppedMidLoop({ ...run, blockedId: undefined, namedInSteer: id }, { headline: REFUSED_HEADLINE, steer, err });
}

/**
 * A refusal blocks every later write too, so stop — but once books have committed, they must
 * stay visible or the model retries the whole set (#33, #213). Records `id` as failed.
 */
function refusedStop(run: LoopState, id: number, err: unknown): ToolResult {
  const shown = presentFailedWrite({ kind: "refused" }, { id, err });
  if (run.applied.length === 0) return toolError(shown.code, shown.text, { hint: shown.hint });
  run.failed.push({ id, error: shown.text });
  return stoppedMidLoop(
    { ...run, blockedId: id },
    { headline: REFUSED_HEADLINE, steer: REFUSED_STEER, err, code: shown.code },
  );
}
