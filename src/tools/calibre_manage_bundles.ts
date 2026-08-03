// calibre_manage_bundles (#19, D-019) — CRUD for Bundles: named topical filters backed by
// Calibre SAVED SEARCHES, plus read-only listing of virtual libraries. Saved searches are the
// only writable filter store: no Content Server endpoint writes virtual libraries, and the only
// alternative (a direct SQLite prefs write) races the running GUI — so VLs are listed and usable
// but never created/edited here, and results say `created_as: saved_search` so the model can't
// imply otherwise. Gated write + preview-first (D-003): create/update first report how many books
// the expression matches, which doubles as free expression validation.

import { z } from "zod";
import { CalibreHttpError } from "../domain/errors.js";
import { CoercedBool } from "./coerce.js";
import { defineTool } from "./define.js";
import { toolError, toolOk } from "./result.js";
import type { ToolDeps } from "./types.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "./write-refusal.js";

export interface BundleEntry {
  name: string;
  expression: string;
  kind: "saved_search" | "virtual_library";
  /** Virtual libraries can be read and used as filters, but not written from here. */
  read_only: boolean;
  /** A leading `-` marks a bundle whose books discovery searches subtract by default. */
  is_exclusion_marker: boolean;
}

/**
 * Parse `calibredb saved_searches list` stdout. The CLI prints one `Name:` / `Search string:`
 * pair per search, and prepends unrelated noise ("Integration status: False") that must be
 * tolerated rather than parsed. A pair is only emitted once its search string arrives.
 */
export function parseSavedSearches(stdout: string): Array<{ name: string; expression: string }> {
  const out: Array<{ name: string; expression: string }> = [];
  let pending: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const name = /^Name:\s*(.*)$/.exec(line);
    if (name) {
      pending = (name[1] ?? "").trim();
      continue;
    }
    const expr = /^Search string:\s*(.*)$/.exec(line);
    if (expr && pending !== undefined) {
      out.push({ name: pending, expression: (expr[1] ?? "").trim() });
      pending = undefined;
    }
  }
  return out;
}

/**
 * argv for a saved-search write. The `--` separator MUST come after every option (the client
 * prepends `--with-library` ahead of the subcommand) and BEFORE the name — probed on 9.11:
 * an option placed after `--` is read as a positional, calibredb then falls back to the local
 * DB and dies on the GUI lock. `--` before the name is also what lets exclusion markers
 * (`-outdated`) through instead of being parsed as a flag.
 */
export function buildSavedSearchArgs(
  action: "add" | "remove",
  name: string,
  expression?: string,
): string[] {
  const args = ["saved_searches", action, "--", name];
  if (action === "add") args.push(expression ?? "");
  return args;
}

export function isExclusionMarker(name: string): boolean {
  return name.startsWith("-");
}

/** Merge saved searches (writable) with virtual libraries (read-only) into one bundle list. */
export function mergeBundles(
  savedSearches: Array<{ name: string; expression: string }>,
  virtualLibraries: Record<string, string>,
): BundleEntry[] {
  const entries: BundleEntry[] = savedSearches.map((s) => ({
    name: s.name,
    expression: s.expression,
    kind: "saved_search",
    read_only: false,
    is_exclusion_marker: isExclusionMarker(s.name),
  }));
  for (const [name, expression] of Object.entries(virtualLibraries)) {
    entries.push({
      name,
      expression,
      kind: "virtual_library",
      read_only: true,
      is_exclusion_marker: isExclusionMarker(name),
    });
  }
  return entries;
}

/** Read every bundle. VLs are a nicety — a failing /interface-data must not kill `list`. */
async function loadBundles(deps: ToolDeps, library?: string): Promise<BundleEntry[]> {
  const libId = await deps.content.resolveLibraryId(library);
  const { stdout } = await deps.calibre.calibredb(["saved_searches", "list"], { library: libId });
  let vls: Record<string, string> = {};
  try {
    vls = await deps.content.virtualLibraries(library);
  } catch (err) {
    deps.log.warn("virtual-library listing failed", {
      msg: err instanceof Error ? err.message : String(err),
    });
  }
  return mergeBundles(parseSavedSearches(stdout), vls);
}

/**
 * Count the books an expression matches (`/ajax/search?num=0`). Two probed quirks shape the
 * reporting: a syntax error comes back as HTTP 500 with an EMPTY body, and an unknown field
 * silently returns 0 matches — indistinguishable from a valid-but-empty search, so callers
 * must hedge on zero rather than claim the expression is fine.
 */
async function countMatches(
  deps: ToolDeps,
  expression: string,
  library?: string,
): Promise<{ total: number } | { error: string }> {
  try {
    const page = await deps.content.search({ query: expression, library, num: 0 });
    return { total: page.total };
  } catch (err) {
    if (err instanceof CalibreHttpError && err.status >= 500) {
      return {
        error:
          `Calibre rejected the search expression \`${expression}\` as invalid syntax. ` +
          "Fix the expression (Calibre search grammar, e.g. `tag:rust and format:EPUB`) and retry.",
      };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function bundleList(entries: BundleEntry[]): string {
  if (entries.length === 0) return "(none)";
  return entries
    .map((b) => {
      const flags = [b.kind === "virtual_library" ? "virtual library, read-only" : "saved search"];
      if (b.is_exclusion_marker) flags.push("exclusion marker");
      return `- ${b.name} [${flags.join(", ")}]: ${b.expression}`;
    })
    .join("\n");
}

/** Preview text for create/update — the match count plus the zero-match caveat. */
function previewText(
  action: "create" | "update",
  name: string,
  expression: string,
  total: number,
  existing?: BundleEntry,
): string {
  const head =
    action === "create"
      ? `Preview — nothing written yet. Would create the bundle "${name}" as a Calibre saved search:`
      : `Preview — nothing written yet. Would replace the bundle "${name}" ` +
        `(currently \`${existing?.expression ?? ""}\`) with:`;
  const zeroNote =
    total === 0
      ? "\nNote: 0 matches. Calibre returns 0 for an unknown field name too, so double-check " +
        "the field spelling before committing."
      : "";
  const markerNote = isExclusionMarker(name)
    ? "\nThe leading `-` makes this an exclusion marker: discovery searches subtract its books by default."
    : "";
  return (
    `${head}\n  ${expression}\nMatches ${total} book(s) right now.${zeroNote}${markerNote}\n` +
    `Re-run with confirm=true to write it.`
  );
}

/**
 * Run one saved-search write. Returns an actionable failure message, or undefined on success —
 * a returned reason (rather than a throw) is what lets the update path roll back and still
 * report WHY the write failed.
 */
async function tryWrite(
  deps: ToolDeps,
  args: readonly string[],
  libId: string,
): Promise<string | undefined> {
  try {
    await deps.calibre.calibredb(args, { library: libId });
    return undefined;
  } catch (err) {
    if (isWriteRefused(err)) return WRITE_REFUSED_MESSAGE;
    return err instanceof Error ? err.message : String(err);
  }
}

export const manageBundlesTool = defineTool({
  name: "calibre_manage_bundles",
  title: "Manage bundles (saved searches)",
  description:
    "List, create, update or delete Bundles — named topical filters backed by Calibre saved " +
    "searches (e.g. a 'rust' bundle scoping searches to Rust books). A name starting with '-' " +
    "is an exclusion marker. Also lists virtual libraries, which are read-only here. " +
    "Preview-first: create/update report the match count until confirm=true. Requires writes to be enabled.",
  inputSchema: {
    action: z.enum(["list", "create", "update", "delete"]),
    name: z.string().trim().optional(),
    expression: z.string().trim().optional(),
    library: z.string().optional(),
    confirm: CoercedBool().default(false),
  },
  outputSchema: {
    action: z.string().optional(),
    bundles: z
      .array(
        z.object({
          name: z.string(),
          expression: z.string(),
          kind: z.string(),
          read_only: z.boolean(),
          is_exclusion_marker: z.boolean(),
        }),
      )
      .optional(),
    applied: z.boolean().optional(),
    created_as: z.string().optional(),
    matches: z.number().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  write: true,
  handler: async (args, deps) => {
    try {
      const name = args.name?.trim();
      const expression = args.expression?.trim();

      if (args.action === "list") {
        const bundles = await loadBundles(deps, args.library);
        return toolOk(
          [{ type: "text", text: `Bundles (${bundles.length}):\n${bundleList(bundles)}` }],
          { action: "list", bundles },
        );
      }

      if (!name) return toolError(`action=${args.action} requires a bundle name.`);

      const bundles = await loadBundles(deps, args.library);
      const existing = bundles.find((b) => b.name === name);
      const writableNames = bundles.filter((b) => !b.read_only).map((b) => b.name);

      // Virtual libraries have no write path at all (D-019) — steer to the GUI rather than
      // silently creating a same-named saved search that would shadow it.
      if (existing?.kind === "virtual_library") {
        return toolError(
          `"${name}" is a virtual library, which is read-only here — calibre-mcp cannot create, ` +
            "change or delete virtual libraries. Manage it in the Calibre GUI, or use a differently " +
            "named bundle (saved search) instead.",
        );
      }

      const libId = await deps.content.resolveLibraryId(args.library);

      if (args.action === "delete") {
        if (!existing) {
          return toolError(
            `No bundle named "${name}". Existing bundles: ${writableNames.join(", ") || "(none)"}.`,
          );
        }
        if (!args.confirm) {
          return toolOk(
            [
              {
                type: "text",
                text:
                  `Preview — nothing deleted yet. Would delete the saved search "${name}" ` +
                  `(\`${existing.expression}\`). No books are touched, only the filter. ` +
                  `Re-run with confirm=true to delete it.`,
              },
            ],
            { action: "delete", applied: false, bundles: [existing] },
          );
        }
        const failure = await tryWrite(deps, buildSavedSearchArgs("remove", name), libId);
        if (failure) return toolError(failure);
        return toolOk(
          [{ type: "text", text: `Deleted the saved search "${name}". No books were touched.` }],
          { action: "delete", applied: true },
        );
      }

      // create / update
      if (!expression) {
        return toolError(
          `action=${args.action} requires an expression (Calibre search grammar, e.g. \`tag:rust\`).`,
        );
      }
      if (args.action === "create" && existing) {
        return toolError(
          `A bundle named "${name}" already exists (\`${existing.expression}\`). ` +
            "Use action=update to change it.",
        );
      }
      if (args.action === "update" && !existing) {
        return toolError(
          `No bundle named "${name}" to update. Existing bundles: ` +
            `${writableNames.join(", ") || "(none)"}. Use action=create to add it.`,
        );
      }

      const count = await countMatches(deps, expression, args.library);
      if ("error" in count) return toolError(count.error);

      if (!args.confirm) {
        return toolOk(
          [{ type: "text", text: previewText(args.action, name, expression, count.total, existing) }],
          { action: args.action, applied: false, matches: count.total, created_as: "saved_search" },
        );
      }

      // update = remove + add: calibredb has no in-place edit for a saved search. That leaves a
      // window where the bundle exists nowhere, so a failed add rolls the old expression back —
      // a failed edit must never silently destroy the filter it was editing.
      const oldExpression = args.action === "update" ? (existing?.expression ?? "") : undefined;
      if (args.action === "update") {
        const removeFailure = await tryWrite(deps, buildSavedSearchArgs("remove", name), libId);
        if (removeFailure) return toolError(removeFailure);
      }

      const addFailure = await tryWrite(deps, buildSavedSearchArgs("add", name, expression), libId);
      if (addFailure) {
        if (oldExpression === undefined) return toolError(addFailure);
        const rollbackFailure = await tryWrite(
          deps,
          buildSavedSearchArgs("add", name, oldExpression),
          libId,
        );
        if (rollbackFailure) {
          deps.log.error("bundle update rollback failed", { name, addFailure, rollbackFailure });
          return toolError(
            `Update of bundle "${name}" failed (${addFailure}), and restoring the original ` +
              `also failed (${rollbackFailure}) — the bundle no longer exists. Recreate it with ` +
              `action=create, name "${name}", expression \`${oldExpression}\`.`,
          );
        }
        return toolError(
          `Update of bundle "${name}" failed (${addFailure}). The original expression ` +
            `\`${oldExpression}\` was restored, so nothing was lost. Fix the new expression and retry.`,
        );
      }

      const verb = args.action === "create" ? "Created" : "Updated";
      return toolOk(
        [
          {
            type: "text",
            text:
              `${verb} bundle "${name}" as a Calibre saved search (created_as: saved_search — ` +
              `not a virtual library), expression \`${expression}\`, matching ${count.total} book(s).`,
          },
        ],
        {
          action: args.action,
          applied: true,
          created_as: "saved_search",
          matches: count.total,
        },
      );
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});
