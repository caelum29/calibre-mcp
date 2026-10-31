// calibre_add_book (#13) — import a local ebook file into the library via `calibredb add`,
// routed through the Content Server URL. Gated write. The path is whitelisted to configured
// roots (symlink-resolved boundary check, DESIGN §5) so a caller can't import arbitrary files.

import { z } from "zod";
import { defineTool } from "./define.js";
import { validateAddPath } from "./add-path.js";
import { probeDuplicates, renderHint, type PossibleDuplicate } from "./add-dup-probe.js";
import { toolError, toolOk } from "./result.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "../app/write-policy.js";

/**
 * Pull the numeric ids out of calibredb's "Added book ids: 1, 2" success line. Matching is
 * confined to that one line ([ \t], not \s) so trailing output (e.g. a later "0 books") isn't
 * swept in.
 */
export function parseAddedIds(stdout: string): number[] {
  const m = stdout.match(/Added book ids?:[ \t]*([\d,\t ]+)/i);
  if (!m?.[1]) return [];
  return m[1]
    .split(/[,\s]+/)
    .filter((s) => s.length > 0) // drop empties first — Number("") is 0, not NaN
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n));
}

export const addBookTool = defineTool({
  name: "calibre_add_book",
  title: "Add a book file",
  description:
    "Import a local ebook file (EPUB/PDF/MOBI/…) into the library. The file must live under an " +
    "allowed import root and be reachable by the Calibre server process. Flags possible duplicates (advisory). Requires writes to be enabled.",
  inputSchema: {
    path: z.string().min(1),
    library: z.string().optional(),
  },
  outputSchema: {
    addedIds: z.array(z.number()).optional(),
    path: z.string().optional(),
    possibleDuplicates: z
      .array(z.object({ id: z.number(), of: z.array(z.number()), reason: z.enum(["isbn", "title"]) }))
      .optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  write: true,
  handler: async (args, deps) => {
    try {
      const check = validateAddPath(args.path, deps.config.addRoots);
      if (!check.ok) return toolError(check.reason);

      // calibredb --with-library needs the library ID, not the display name (routed-write 404 fix).
      const libId = await deps.content.resolveLibraryId(args.library);

      let stdout: string;
      try {
        // Imports/conversions can legitimately exceed the 30s default; the group-kill
        // in spawn.ts still bounds a true hang.
        ({ stdout } = await deps.calibre.calibredb(["add", check.resolved], {
          library: libId,
          timeoutMs: 120_000,
        }));
      } catch (err) {
        if (isWriteRefused(err)) return toolError(WRITE_REFUSED_MESSAGE);
        throw err;
      }

      const addedIds = parseAddedIds(stdout);
      const summary =
        addedIds.length > 0
          ? `Added ${addedIds.length} book(s) (id ${addedIds.join(", ")}) from ${check.resolved}.`
          : `calibredb reported no new ids (possible duplicate) for ${check.resolved}.`;

      // Advisory only (#204): calibredb's duplicate check misses raw-titled imports, so look again.
      // The add already committed — a failed probe must never turn it into an error.
      let dups: PossibleDuplicate[] = [];
      if (addedIds.length > 0) {
        try {
          dups = await probeDuplicates(deps, addedIds, args.library);
        } catch (err) {
          deps.log.warn("add_book duplicate probe failed", {
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // Hint goes in the text too: some clients surface only text blocks.
      const text = dups.length > 0 ? `${summary}\n${dups.map(renderHint).join("\n")}` : summary;
      return toolOk([{ type: "text", text }], {
        addedIds,
        path: check.resolved,
        ...(dups.length > 0 ? { possibleDuplicates: dups } : {}),
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});
