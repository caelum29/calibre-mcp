// calibre_remove_book (#14) — destructive-but-recoverable. Removes book records via
// `calibredb remove`, routed through the Content Server URL. We never pass --permanent, so
// removed books land in Calibre's Trash and are restorable from the GUI. Gated write, and
// additionally confirm-gated: without confirm=true it returns a dry-run of what WOULD be
// removed and writes nothing (in-band confirmation; MCP elicitation is a LATER upgrade).
// The dry-run is a SUCCESS result, not isError — an error here reads as "dangerous/failed"
// and makes agents refuse the confirm step. A timed-out or dropped remove is settled by a re-read (#584).

import { writeStep } from "./writes-remedy.js";
import { z } from "zod";
import { BookId, CoercedBool, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { resolveNumericId } from "../app/resolve-id.js";
import { toolError, toolOk, errorFromCatch } from "./result.js";
import { isLanded, reReadNote, type ReReadCause } from "../app/write-policy.js";
import { settleFailedRemove, unconfirmedRemove } from "../app/remove-settle.js";
import { presentFailedWrite } from "./write-failure.js";
import { pruneRemovedBooks } from "../app/prune-removed.js";
import type { DepsWithIndex } from "./deps.js";
import type { IndexWriter } from "../semantic/store/types.js";
import type { ToolResult } from "./types.js";

/** Remove's deps: the library plus the index prune port (#496). */
export type RemoveBookDeps = DepsWithIndex<Pick<IndexWriter, "deleteBooks">>;

export const removeBookTool = defineTool({
  name: "calibre_remove_book",
  title: "Remove books",
  description:
    "Remove books (ids) from the library. Removed books go to Calibre's Trash and can be restored from " +
    "the Calibre GUI, so this is recoverable. Two-step: the first call is a dry-run listing what " +
    "would be removed; re-run with confirm=true to proceed. Previews work without writes; applying needs CALIBRE_MCP_ENABLE_WRITE.",
  inputSchema: {
    ids: jsonArray(BookId()),
    library: z.string().optional(),
    confirm: CoercedBool().default(false),
  },
  outputSchema: {
    deleted: z.boolean().optional(),
    removedIds: z.array(z.number()).optional(),
    wouldRemove: z.array(z.object({ id: z.number(), title: z.string().optional() })).optional(),
    notFoundIds: z.array(z.union([z.number(), z.string()])).optional(),
    // #496: present only when the post-remove index prune failed — the remove itself committed
    indexNote: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  write: true,
  writeCall: (args) => args.confirm,
  handler: async (args, deps: RemoveBookDeps) => {
    try {
      if (!Array.isArray(args.ids) || args.ids.length === 0) {
        return toolError("invalid_input", "Provide at least one book id to remove.");
      }

      // Resolve every id (uuids too); drop unresolvable ones so a stale id can't take the batch down.
      const numericIds: number[] = [];
      const notFoundIds: (number | string)[] = [];
      for (const id of args.ids) {
        const num = await resolveNumericId(deps, id, args.library);
        if (num !== undefined) numericIds.push(num);
        else notFoundIds.push(id);
      }

      // A numeric id always "resolves"; only the library lookup says whether the book exists (#519).
      const map = numericIds.length > 0 ? await deps.content.booksByIds(numericIds, args.library) : new Map();
      const targets: { id: number; title?: string }[] = [];
      for (const id of numericIds) {
        const found = map.get(id);
        if (found) targets.push({ id, title: found.title });
        else notFoundIds.push(id);
      }
      if (targets.length === 0) {
        return toolError(
          "not_found",
          `None of the given ids is a book in this library: ${notFoundIds.map((i) => `#${i}`).join(", ")}.`,
        );
      }
      // Known limits, decided on #529 (2026-11-10): an unresolved uuid prints with a `#` prefix (reads
      // like a numeric id), and duplicate ids in the input are not de-duplicated, so the count can
      // include one book twice.
      // same wording in the text and in structuredContent — clients show the model only one of them
      const skipped =
        notFoundIds.length > 0 ? `Not found (skipped): ${notFoundIds.map((i) => `#${i}`).join(", ")}` : "";
      const notFound = notFoundIds.length > 0 ? { notFoundIds } : {};

      // Dry-run unless explicitly confirmed. Success result, not isError — the gate worked
      // as designed, and an error result makes agents refuse the confirm step.
      if (!args.confirm) {
        const list = targets.map((t) => `#${t.id} ${t.title ?? "(untitled)"}`).join("\n");
        return toolOk(
          [
            {
              type: "text",
              text:
                `Dry-run — nothing removed yet. This would move ${targets.length} book(s) to ` +
                `Calibre's Trash (restorable from the Calibre GUI):\n${list}\n` +
                (skipped ? `${skipped}\n` : "") +
                writeStep(deps.config.writeEnabled, `Re-run with confirm=true to proceed.`, "Removing them"),
            },
          ],
          { deleted: false, wouldRemove: targets, ...notFound },
        );
      }

      // calibredb remove takes a comma-separated id list; needs the library ID, not display name.
      const libId = await deps.content.resolveLibraryId(args.library);
      const removeIds = targets.map((t) => t.id);
      let confirmedBy: ReReadCause | undefined;
      try {
        await deps.calibre.calibredb(["remove", removeIds.join(",")], { library: libId });
      } catch (err) {
        const settled = await settleRemoveError(deps, { libId, removeIds, library: args.library, skipped }, err);
        if (typeof settled !== "string") return settled;
        confirmedBy = settled;
      }

      // calibredb replied (or a re-read saw every id gone): the index follows it (best-effort, #496)
      const indexNote = pruneRemovedBooks(deps, libId, removeIds);
      return toolOk(
        [
          {
            type: "text",
            text:
              `Removed ${removeIds.length} book(s): ${removeIds.join(", ")}. ` +
              `They went to Calibre's Trash and can be restored from the Calibre GUI.` +
              (confirmedBy ? reReadNote(confirmedBy) : "") +
              (skipped ? `\n${skipped}` : "") +
              (indexNote ? `\n${indexNote}` : ""),
          },
        ],
        { deleted: true, removedIds: removeIds, ...notFound, ...(indexNote ? { indexNote } : {}) },
      );
    } catch (err) {
      return errorFromCatch(err);
    }
  },
});

/** The confirmed remove a failed `calibredb remove` was about; `skipped` is the not-found line. */
interface FailedRemoveCall {
  libId: string;
  removeIds: number[];
  library?: string;
  skipped: string;
}

/**
 * Settle a failed `calibredb remove` (#584): a timeout or drop may have committed, so it is
 * re-read, never reported as a plain failure. Returns the cause when the re-read saw every id
 * gone (a success), else the error result; rethrows what never reached the server.
 */
async function settleRemoveError(
  deps: RemoveBookDeps,
  call: FailedRemoveCall,
  err: unknown,
): Promise<ReReadCause | ToolResult> {
  const { libId, removeIds } = call;
  const { outcome, gone, remaining } = await settleFailedRemove(deps, removeIds, err, call.library);
  if (isLanded(outcome)) return outcome.cause;
  if (outcome.kind === "unexpected" || outcome.kind === "transient") throw err;
  // ids the re-read shows gone are removed: the index follows them even when the rest is unconfirmed
  const pruneNote = gone.length > 0 ? pruneRemovedBooks(deps, libId, gone) : undefined;
  const { code, text, hint } = presentFailedWrite(outcome, {
    id: remaining[0] ?? removeIds[0] ?? 0,
    retries: 0,
    err,
    unconfirmed: (cause, check) => unconfirmedRemove(cause, check.status, { gone, remaining }),
  });
  const extra = [call.skipped, pruneNote].filter(Boolean).join("\n");
  return toolError(code, extra ? `${text}\n${extra}` : text, { hint });
}
