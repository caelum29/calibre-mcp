// calibre_ping — connectivity probe that proves the SUBPROCESS path (calibredb --with-library
// URL) works, complementary to calibre_list_libraries (HTTP /ajax). Also carries the
// semantic-search self-diagnosis (#48), the server's recent errors + log file (#247), and the
// libraries the busy breaker is currently failing fast (calibre/busy.ts).

import { defineTool } from "./define.js";
import { toolText } from "./result.js";
import { computeSemanticStatus, formatSemanticStatusLine } from "../semantic/status.js";
import { capString, log } from "../logging.js";
import type { BusyLibrary } from "../calibre/busy.js";
import type { LibId } from "../calibre/lib-id.js";
import { CalibreBusyError } from "../domain/errors.js";
import { SDK_VERSION, VERSION } from "../version.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../semantic/model.js";
import type { ToolDeps, ToolResult } from "./types.js";

export const pingTool = defineTool({
  name: "calibre_ping",
  title: "Calibre ping",
  description:
    "Health check: confirms the MCP server can reach the running Calibre " +
    "Content Server via calibredb, and reports semantic-search status " +
    "(embedding model, dependency, per-library index coverage). Returns the server version, calibredb path " +
    "and write-gate state, plus libraries currently marked busy after a Calibre timeout, the server's recent errors and its " +
    "log file path for self-diagnosis.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (_args, deps): Promise<ToolResult> => {
    // Resolve the libId (needed for both calibredb and the index vector count) first —
    // --with-library needs the ID, not the display name. A failure here is non-fatal to the
    // semantic diagnosis (it reads local disk/state), so keep it and still report semantics.
    let libId: LibId | undefined;
    let pingError: string | undefined;
    try {
      libId = await deps.content.resolveLibraryId();
      // reachability probe only; its raw category dump is noise, so it is not echoed (#304)
      await deps.calibre.listLibraries(libId);
    } catch (err) {
      pingError = err instanceof Error ? err.message : String(err);
      // Busy is a known, self-clearing state (reported below), not a server fault.
      if (err instanceof CalibreBusyError) deps.log.warn("ping refused: library busy", { libraryId: err.libraryId });
      else deps.log.error("ping failed", { error: pingError });
    }
    const busy = busyReport(deps.libraryBusy?.busyLibraries() ?? []);

    const semantic = computeSemanticStatus(deps, libId);
    const semLine = formatSemanticStatusLine(semantic);
    // Self-diagnosis without file access (#247). Text too — Desktop strips structuredContent.
    const diag = diagnostics();
    const serverUrl = deps.config.serverUrl;
    const header = serverHeader(deps);
    const indexLine = await libraryIndexLine(deps);

    if (pingError !== undefined) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Calibre unreachable: ${pingError}\n${header}\n${busy.text}${semLine}\n${indexLine}\n${diag.text}`,
          },
        ],
        structuredContent: { ok: false, error: pingError, serverUrl, semantic, ...busy.structured, ...diag.structured },
      };
    }
    return toolText(`ok\n${header}\n${busy.text}${semLine}\n${indexLine}\n${diag.text}`, {
      ok: true,
      serverUrl,
      semantic,
      ...busy.structured,
      ...diag.structured,
    });
  },
});

/**
 * Recent server-side errors (oldest first) + today's log file. Reads the process logger,
 * not deps.log: the ring buffer and file sink live only there (deps.log is the narrow sink).
 */
function diagnostics(): { text: string; structured: Record<string, unknown> } {
  const recentErrors = log.recentErrors().map((r) => ({
    ts: r.ts,
    msg: r.msg,
    ...(r.tool ? { tool: r.tool, call: r.call } : {}),
    ...(r.meta === undefined ? {} : { meta: r.meta }),
  }));
  const logFile = log.currentFile();
  const lines = [`log file: ${logFile ?? "off (stderr only)"}`, `recent errors: ${recentErrors.length}`];
  // All of them, newest first — Desktop reads only this text, so it must match structuredContent.
  for (const e of [...recentErrors].reverse()) {
    const meta = e.meta === undefined ? "" : ` ${capString(JSON.stringify(e.meta), 200)}`;
    lines.push(`- ${e.ts}${e.tool ? ` [${e.tool} call=${e.call}]` : ""} ${e.msg}${meta}`);
  }
  return { text: lines.join("\n"), structured: { logFile, recentErrors } };
}

/** Busy-breaker state as one text line per library (empty when none) + its structured mirror. */
function busyReport(list: BusyLibrary[]): { text: string; structured: Record<string, unknown> } {
  if (list.length === 0) return { text: "", structured: {} };
  const lines = list.map(
    (b) =>
      `busy: library "${b.libraryId}" — Calibre timed out (${b.source}) at ${b.since}; ` +
      `calls fail fast for ~${Math.ceil(b.retryInMs / 1000)} s more`,
  );
  return { text: `${lines.join("\n")}\n`, structured: { busyLibraries: list } };
}

/** Version / calibredb / write-gate block — facts a session otherwise has to infer (#304). */
function serverHeader(deps: ToolDeps): string {
  const writes = deps.config.writeEnabled
    ? "writes: ENABLED (CALIBRE_MCP_ENABLE_WRITE)"
    : "writes: disabled (set CALIBRE_MCP_ENABLE_WRITE to enable)";
  return [
    `calibre-mcp ${VERSION} (MCP SDK ${SDK_VERSION})`,
    `calibredb: ${deps.config.calibredbPath} (Content Server ${deps.config.serverUrl})`,
    writes,
  ].join("\n");
}

/**
 * One line of per-library index coverage, e.g. `Index: Programming Books: 1064/1092 indexed ·
 * Reaserch Books: none`. Each library degrades on its own (unreachable total → `?`, locked or
 * unreadable store, stale index) so ping itself never fails here. Reads only existing public
 * IndexStore methods; never creates an index file.
 */
async function libraryIndexLine(deps: ToolDeps): Promise<string> {
  let map: Record<string, string>;
  try {
    map = (await deps.content.libraryInfo()).libraryMap;
  } catch {
    return "Index: libraries unavailable";
  }
  const parts = await Promise.all(
    Object.entries(map).map(async ([id, name]) => {
      let booksIndexed: number;
      try {
        if (!deps.index.hasIndex(id)) return `${name}: none`;
        const meta = deps.index.indexMeta(id);
        if (meta && (meta.modelId !== MODEL_ID || meta.dim !== EMBED_DIM || meta.indexVersion !== INDEX_VERSION)) {
          return `${name}: stale index (rebuild)`;
        }
        booksIndexed = deps.index.stats(id).books;
      } catch {
        return `${name}: index unreadable`;
      }
      // total is a cheap num=0 count; if the server can't answer, still show what is indexed
      let total = "?";
      try {
        total = String((await deps.content.search({ query: "", library: id, num: 0, timeoutMs: 5000 })).total);
      } catch {
        // keep "?"
      }
      return `${name}: ${booksIndexed}/${total} indexed`;
    }),
  );
  return `Index: ${parts.length > 0 ? parts.join(" · ") : "(no libraries)"}`;
}
