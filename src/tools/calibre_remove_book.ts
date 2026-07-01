// calibre_remove_book (#14) — DESTRUCTIVE. Deletes book records AND their files from the
// library via `calibredb remove`, routed through the Content Server URL. Gated write, and
// additionally confirm-gated: without confirm=true it returns a dry-run of what WOULD be
// deleted and writes nothing (in-band confirmation; MCP elicitation is a LATER upgrade).

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
    "Permanently delete books from the library — removes both the metadata records and the format " +
    "files on disk. Destructive: requires confirm=true (otherwise returns a dry-run). Requires " +
    "writes to be enabled.",
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

      // Dry-run unless explicitly confirmed — this deletes files, so we gate harder than preview.
      if (!args.confirm) {
        const list = targets.map((t) => `#${t.id} ${t.title ?? "(unknown)"}`).join("\n");
        return toolError(
          `Nothing deleted. This permanently removes ${targets.length} book(s) — records AND files ` +
            `on disk. Re-run with confirm=true to proceed:\n${list}`,
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
        [{ type: "text", text: `Removed ${numericIds.length} book(s): ${numericIds.join(", ")}.` }],
        { deleted: true, removedIds: numericIds },
      );
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});
