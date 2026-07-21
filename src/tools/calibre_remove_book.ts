// calibre_remove_book (#14) — destructive-but-recoverable. Removes book records via
// `calibredb remove`, routed through the Content Server URL. We never pass --permanent, so
// removed books land in Calibre's Trash and are restorable from the GUI. Gated write, and
// additionally confirm-gated: without confirm=true it returns a dry-run of what WOULD be
// removed and writes nothing (in-band confirmation; MCP elicitation is a LATER upgrade).
// The dry-run is a SUCCESS result, not isError — an error here reads as "dangerous/failed"
// and makes agents refuse the confirm step.

import { z } from "zod";
import { BookId, CoercedBool, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { resolveNumericId } from "./resolve-id.js";
import { toolError, toolOk } from "./result.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "./write-refusal.js";

export const removeBookTool = defineTool({
  name: "calibre_remove_book",
  title: "Remove books",
  description:
    "Remove books from the library. Removed books go to Calibre's Trash and can be restored from " +
    "the Calibre GUI, so this is recoverable. Two-step: the first call is a dry-run listing what " +
    "would be removed; re-run with confirm=true to proceed. Requires writes to be enabled.",
  inputSchema: {
    ids: jsonArray(BookId()),
    library: z.string().optional(),
    confirm: CoercedBool().default(false),
  },
  outputSchema: {
    deleted: z.boolean().optional(),
    removedIds: z.array(z.number()).optional(),
    wouldRemove: z
      .array(z.object({ id: z.number(), title: z.string().optional() }))
      .optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  write: true,
  handler: async (args, deps) => {
    try {
      if (!Array.isArray(args.ids) || args.ids.length === 0) {
        return toolError("Provide at least one book id to remove.");
      }

      // Resolve every id (uuids too); drop unknowns so a stale id can't take the batch down.
      const numericIds: number[] = [];
      for (const id of args.ids) {
        const num = await resolveNumericId(deps, id, args.library);
        if (num !== undefined) numericIds.push(num);
      }
      if (numericIds.length === 0) return toolError("None of the given ids resolved to a book.");

      const map = await deps.content.booksByIds(numericIds, args.library);
      const targets = numericIds.map((id) => ({ id, title: map.get(id)?.title }));

      // Dry-run unless explicitly confirmed. Success result, not isError — the gate worked
      // as designed, and an error result makes agents refuse the confirm step.
      if (!args.confirm) {
        const list = targets.map((t) => `#${t.id} ${t.title ?? "(unknown)"}`).join("\n");
        return toolOk(
          [
            {
              type: "text",
              text:
                `Dry-run — nothing removed yet. This would move ${targets.length} book(s) to ` +
                `Calibre's Trash (restorable from the Calibre GUI):\n${list}\n` +
                `Re-run with confirm=true to proceed.`,
            },
          ],
          { deleted: false, wouldRemove: targets },
        );
      }

      // calibredb remove takes a comma-separated id list; needs the library ID, not display name.
      const libId = await deps.content.resolveLibraryId(args.library);
      try {
        await deps.calibre.calibredb(["remove", numericIds.join(",")], { library: libId });
      } catch (err) {
        if (isWriteRefused(err)) return toolError(WRITE_REFUSED_MESSAGE);
        throw err;
      }

      return toolOk(
        [
          {
            type: "text",
            text:
              `Removed ${numericIds.length} book(s): ${numericIds.join(", ")}. ` +
              `They went to Calibre's Trash and can be restored from the Calibre GUI.`,
          },
        ],
        { deleted: true, removedIds: numericIds },
      );
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});
