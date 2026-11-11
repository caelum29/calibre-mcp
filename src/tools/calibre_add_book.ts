// calibre_add_book (#13) — import a local ebook file into the library via `calibredb add`,
// routed through the Content Server URL. Gated write. The path is whitelisted to configured
// roots (symlink-resolved boundary check, DESIGN §5) so a caller can't import arbitrary files.

import { calibredbArgv } from "../calibre/calibredb-argv.js";
import { z } from "zod";
import { defineTool } from "./define.js";
import { ADD_ROOTS_STEP, validateAddPath } from "./add-path.js";
import {
  findSkippedDuplicate,
  probeDuplicates,
  renderHint,
  renderNotProbed,
  renderProbeFailed,
} from "./add-dup-probe.js";
import { unprobedIds, type PossibleDuplicate } from "../domain/curation/add-probe.js";
import { toolError, toolOk, errorFromCatch } from "./result.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "../app/write-policy.js";
import type { BaseDeps } from "./deps.js";
import type { ToolResult } from "./types.js";

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

/**
 * Titles calibredb reports as skipped duplicates. Its report goes to stderr: a header that
 * names the `--duplicates` option (the header text itself is localized), then one indented
 * title per skipped book; the file paths go to stdout.
 */
export function parseSkippedTitles(stderr: string): string[] {
  const lines = stderr.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes("--duplicates"));
  if (start < 0) return [];
  const titles: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(l)) break;
    titles.push(l.trim());
  }
  return titles;
}

/** Why an add came back with no new ids (#555). */
type NoIdsOutcome = { kind: "duplicate"; title?: string } | { kind: "unknown"; said: string };

// Longest calibredb excerpt quoted back; a traceback must not flood the result.
const SAID_MAX = 300;

/**
 * Classify a no-new-ids add. A parsed duplicate report (stderr, or stdout) → duplicate. Empty
 * stderr → duplicate too: the report format comes from Calibre's code, not a live capture, so
 * an unparsed real skip must keep its label. Any other stderr is an unexplained failure.
 */
export function classifyNoIds(stdout: string, stderr: string): NoIdsOutcome {
  for (const stream of [stderr, stdout]) {
    if (stream.split(/\r?\n/).some((l) => l.includes("--duplicates"))) {
      return { kind: "duplicate", title: parseSkippedTitles(stream)[0] };
    }
  }
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { kind: "duplicate" };
  // a traceback's useful line is its last one (the exception), not "Traceback (most recent…"
  const said = lines.some((l) => l.startsWith("Traceback")) ? lines[lines.length - 1]! : lines[0]!;
  return { kind: "unknown", said: said.length > SAID_MAX ? `${said.slice(0, SAID_MAX)}…` : said };
}

/** Next step after an add that added nothing for an unknown reason (#555). */
const UNKNOWN_HINT =
  "Check the file (format, permissions, not corrupt) and retry; calibre_search for its title shows whether " +
  "it is already in the library.";

/** Next step for a skipped add, shared by text and structuredContent (#555). */
function skipHint(matchId: number | undefined, title: string | undefined): string {
  if (matchId !== undefined) {
    return (
      `calibre_get_book id=${matchId} shows the existing record; to weigh it against other ` +
      `copies, run calibre_find_duplicates mode=compare ids=[${matchId},<other id>].`
    );
  }
  const find = title
    ? `calibre_search query='title:"${title.replace(/"/g, "")}"'`
    : "calibre_search by the book's title";
  return `Find the existing book with ${find}, then review it with calibre_find_duplicates mode=compare.`;
}

export const addBookTool = defineTool({
  name: "calibre_add_book",
  title: "Add a book file",
  description:
    "Import a local ebook file (EPUB/PDF/MOBI/…) into the library by its `path`. The file must live under an " +
    "allowed import root and be reachable by the Calibre server process. A file whose title and author are already in the library is NOT imported: the result says " +
    "`skipped: duplicate` and names the existing book. After a real add, it flags possible duplicates calibredb " +
    "missed. Requires writes to be enabled.",
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
    notProbed: z.array(z.number()).optional(),
    // set when calibredb added nothing: it skips a title+author duplicate (#555)
    skipped: z.enum(["duplicate", "unknown"]).optional(),
    // calibredb's own words when it added nothing for an unknown reason
    reason: z.string().optional(),
    duplicateOf: z.number().optional(),
    hint: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  write: true,
  writeCall: "always", // no call writes nothing → hidden with the gate off (#435)
  handler: async (args, deps) => {
    try {
      const check = validateAddPath(args.path, deps.config.addRoots);
      if (!check.ok)
        return check.outsideRoots
          ? toolError("path_not_allowed", check.reason, { hint: ADD_ROOTS_STEP })
          : toolError("not_found", check.reason);

      // calibredb --with-library needs the library ID, not the display name (routed-write 404 fix).
      const libId = await deps.content.resolveLibraryId(args.library);

      let stdout: string;
      let stderr: string;
      try {
        // Imports/conversions can legitimately exceed the 30s default; the group-kill
        // in spawn.ts still bounds a true hang.
        ({ stdout, stderr } = await deps.calibre.calibredb(calibredbArgv(["add"], [check.resolved]), {
          library: libId,
          timeoutMs: 120_000,
        }));
      } catch (err) {
        if (isWriteRefused(err)) return toolError("write_refused", WRITE_REFUSED_MESSAGE);
        throw err;
      }

      const addedIds = parseAddedIds(stdout);
      if (addedIds.length === 0) return await noIdsResult(deps, check.resolved, stdout, stderr, args.library);
      const summary = `Added ${addedIds.length} book(s) (id ${addedIds.join(", ")}) from ${check.resolved}.`;

      // Advisory only (#204): calibredb's duplicate check misses raw-titled imports, so look again.
      // The add already committed — a failed probe must never turn it into an error.
      let dups: PossibleDuplicate[] = [];
      let failure: string | undefined;
      try {
        dups = await probeDuplicates(deps, addedIds, args.library);
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        deps.log.warn("add_book duplicate probe failed", { reason: failure });
      }
      // the cap depends only on the ids, so its note survives a failed probe
      const notProbed = unprobedIds(addedIds);
      // Hints and notes go in the text too: some clients surface only text blocks.
      const lines = [summary, ...dups.map(renderHint)];
      if (failure !== undefined) lines.push(renderProbeFailed(failure));
      if (notProbed.length > 0)
        lines.push(renderNotProbed(addedIds.length - notProbed.length, addedIds.length, notProbed));
      return toolOk([{ type: "text", text: lines.join("\n") }], {
        addedIds,
        path: check.resolved,
        ...(dups.length > 0 ? { possibleDuplicates: dups } : {}),
        ...(notProbed.length > 0 ? { notProbed } : {}),
      });
    } catch (err) {
      return errorFromCatch(err);
    }
  },
});

/**
 * calibredb added nothing (#555). A duplicate skip says so in both channels, naming the
 * existing book only when exactly one title matches; any other cause is reported as unknown.
 */
async function noIdsResult(
  deps: BaseDeps,
  resolved: string,
  stdout: string,
  stderr: string,
  library?: string,
): Promise<ToolResult> {
  const outcome = classifyNoIds(stdout, stderr);
  if (outcome.kind === "unknown") {
    // not a duplicate: say what calibredb said, never guess a reason (#555 review)
    const text = `No book was added from ${resolved}; calibredb said: ${outcome.said}\nNext: ${UNKNOWN_HINT}`;
    return toolOk([{ type: "text", text }], {
      addedIds: [],
      path: resolved,
      skipped: "unknown",
      reason: outcome.said,
      hint: UNKNOWN_HINT,
    });
  }
  const title = outcome.title;
  let matchId: number | undefined;
  if (title !== undefined) {
    try {
      matchId = await findSkippedDuplicate(deps, title, library);
    } catch (err) {
      // a failed lookup only loses the id, never the skip result
      deps.log.warn("add_book skipped-duplicate lookup failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const hint = skipHint(matchId, title);
  const what = title ? ` "${title}"` : "";
  const head =
    matchId !== undefined
      ? `Not added: calibredb skipped ${resolved}${what} as a duplicate of book #${matchId} (same title and author).`
      : `Not added: calibredb skipped ${resolved}${what} as a duplicate (a book with the same title and author is ` +
        `already in the library); the matching book could not be identified with confidence.`;
  return toolOk([{ type: "text", text: `${head} Nothing was written.\nNext: ${hint}` }], {
    addedIds: [],
    path: resolved,
    skipped: "duplicate",
    ...(matchId !== undefined ? { duplicateOf: matchId } : {}),
    hint,
  });
}
