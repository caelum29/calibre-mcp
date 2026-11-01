// calibre_ping — connectivity probe that proves the SUBPROCESS path (calibredb --with-library
// URL) works, complementary to calibre_list_libraries (HTTP /ajax). Also carries the
// semantic-search self-diagnosis (#48), the server's recent errors + log file (#247), the
// libraries the busy breaker is failing fast (calibre/busy.ts) and index coverage (app/library-index.ts).

import { defineTool } from "./define.js";
import { toolError, toolText } from "./result.js";
import { computeSemanticStatus, formatSemanticStatusLine, type StatusIndex } from "../semantic/status.js";
import { libraryIndexReport, type LibraryIndex } from "../app/library-index.js";
import { capString, log } from "../logging.js";
import type { BusyLibrary } from "../calibre/busy.js";
import type { LibId } from "../calibre/lib-id.js";
import { CalibreBusyError } from "../domain/errors.js";
import { SDK_VERSION, VERSION } from "../version.js";
import type { BaseDeps, DepsWithIndex } from "./deps.js";
import type { ToolResult } from "./types.js";
import { defaultHint, errorCodeFor } from "../domain/error-codes.js";

/** calibre_ping's deps (#272): its index reads are exactly the semantic-status ones. */
export type PingDeps = DepsWithIndex<StatusIndex>;

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
  handler: async (_args, deps: PingDeps): Promise<ToolResult> => {
    // Resolve the libId (needed for both calibredb and the index vector count) first —
    // --with-library needs the ID, not the display name. A failure here is non-fatal to the
    // semantic diagnosis (it reads local disk/state), so keep it and still report semantics.
    let libId: LibId | undefined;
    let pingError: string | undefined;
    let pingCause: unknown;
    try {
      libId = await deps.content.resolveLibraryId();
      // reachability probe only; its raw category dump is noise, so it is not echoed (#304)
      await deps.calibre.listLibraries(libId);
    } catch (err) {
      pingError = err instanceof Error ? err.message : String(err);
      pingCause = err;
      // Busy is a known, self-clearing state (reported below), not a server fault.
      if (err instanceof CalibreBusyError) deps.log.warn("ping refused: library busy", { libraryId: err.libraryId });
      else {
        const errorCode = errorCodeFor(err);
        deps.log.error("ping failed", { error: pingError, errorCode, hint: defaultHint(errorCode) });
      }
    }
    const busy = busyReport(deps.libraryBusy?.busyLibraries() ?? []);

    const semantic = computeSemanticStatus(deps, libId);
    const semLine = formatSemanticStatusLine(semantic);
    // Self-diagnosis without file access (#247). Text too — Desktop strips structuredContent.
    const diag = diagnostics();
    const serverUrl = deps.config.serverUrl;
    const header = serverHeader(deps);
    const index = await indexSection(deps, pingError !== undefined);
    const facts = serverFacts(deps, index.indexes);

    if (pingError !== undefined) {
      return toolError(
        errorCodeFor(pingCause),
        `Calibre unreachable: ${pingError}\n${header}\n${busy.text}${semLine}\n${index.line}\n${diag.text}`,
        {
          bare: true, // the report leads with its own headline, as before
          structured: {
            ok: false,
            error: pingError,
            serverUrl,
            ...facts,
            semantic,
            ...busy.structured,
            ...diag.structured,
          },
        },
      );
    }
    return toolText(`ok\n${header}\n${busy.text}${semLine}\n${index.line}\n${diag.text}`, {
      ok: true,
      serverUrl,
      ...facts,
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

/** structuredContent twin of the header + index line, for clients that show only structured data. */
function serverFacts(deps: BaseDeps, indexes: LibraryIndex[] | undefined): Record<string, unknown> {
  return {
    version: VERSION,
    sdkVersion: SDK_VERSION,
    calibredbPath: deps.config.calibredbPath,
    writeEnabled: deps.config.writeEnabled,
    ...(indexes ? { indexes } : {}),
  };
}

/** Version / calibredb / write-gate block — facts a session otherwise has to infer (#304). */
function serverHeader(deps: BaseDeps): string {
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
 * The index section as one text line + its structured array. With Calibre down the report is
 * skipped: libraryInfo would just burn another full timeout.
 */
async function indexSection(deps: PingDeps, unreachable: boolean): Promise<{ line: string; indexes?: LibraryIndex[] }> {
  if (unreachable) return { line: "Index: skipped — Calibre unreachable" };
  const indexes = await libraryIndexReport(deps);
  if (!indexes) return { line: "Index: libraries unavailable" };
  const part = (i: LibraryIndex): string =>
    i.state === "ok"
      ? `${i.name}: ${i.indexed}/${i.total ?? "?"} indexed${i.withoutEmbeddings ? ` (${i.withoutEmbeddings} without embeddings)` : ""}`
      : i.state === "none"
        ? `${i.name}: none`
        : i.state === "stale"
          ? `${i.name}: stale index (rebuild)`
          : `${i.name}: index unreadable`;
  return { line: `Index: ${indexes.length > 0 ? indexes.map(part).join(" · ") : "(no libraries)"}`, indexes };
}
