// calibre_remove_book (#14) — destructive-but-recoverable. Removes book records via
// `calibredb remove`, routed through the Content Server URL. We never pass --permanent, so
// removed books land in Calibre's Trash and are restorable from the GUI. Gated write, and
// additionally confirm-gated: without confirm=true it returns a dry-run of what WOULD be
// removed and writes nothing (in-band confirmation; MCP elicitation is a LATER upgrade).
// The dry-run is a SUCCESS result, not isError — an error here reads as "dangerous/failed"
// and makes agents refuse the confirm step.

import { writeStep } from "./writes-remedy.js";
import { z } from "zod";
import { BookId, CoercedBool, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { resolveNumericId } from "../app/resolve-id.js";
import { toolError, toolOk, errorFromCatch } from "./result.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "../app/write-policy.js";

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
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  write: true,
  writeCall: (args) => args.confirm,
  handler: async (args, deps) => {
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
      try {
        await deps.calibre.calibredb(["remove", removeIds.join(",")], { library: libId });
      } catch (err) {
        if (isWriteRefused(err)) return toolError("write_refused", WRITE_REFUSED_MESSAGE);
        throw err;
      }

      return toolOk(
        [
          {
            type: "text",
            text:
              `Removed ${removeIds.length} book(s): ${removeIds.join(", ")}. ` +
              `They went to Calibre's Trash and can be restored from the Calibre GUI.` +
              (skipped ? `\n${skipped}` : ""),
          },
        ],
        { deleted: true, removedIds: removeIds, ...notFound },
      );
    } catch (err) {
      return errorFromCatch(err);
    }
  },
});
