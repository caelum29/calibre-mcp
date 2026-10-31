// calibre_ping — connectivity probe that proves the SUBPROCESS path (calibredb --with-library
// URL) works, complementary to calibre_list_libraries (HTTP /ajax). Also carries the
// semantic-search self-diagnosis (#48) and the server's recent errors + log file (#247).

import { defineTool } from "./define.js";
import { toolText } from "./result.js";
import { computeSemanticStatus, formatSemanticStatusLine } from "../semantic/status.js";
import { capString, log } from "../logging.js";
import type { LibId } from "../calibre/lib-id.js";
import type { ToolResult } from "./types.js";

export const pingTool = defineTool({
  name: "calibre_ping",
  title: "Calibre ping",
  description:
    "Health check: confirms the MCP server can reach the running Calibre " +
    "Content Server via calibredb, and reports semantic-search status " +
    "(embedding model, dependency, index vector count). Returns library categories on success, " +
    "plus the server's recent errors and its log file path for self-diagnosis.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (_args, deps): Promise<ToolResult> => {
    // Resolve the libId (needed for both calibredb and the index vector count) first —
    // --with-library needs the ID, not the display name. A failure here is non-fatal to the
    // semantic diagnosis (it reads local disk/state), so keep it and still report semantics.
    let libId: LibId | undefined;
    let listOut: string | undefined;
    let pingError: string | undefined;
    try {
      libId = await deps.content.resolveLibraryId();
      listOut = await deps.calibre.listLibraries(libId);
    } catch (err) {
      pingError = err instanceof Error ? err.message : String(err);
      deps.log.error("ping failed", { error: pingError });
    }

    const semantic = computeSemanticStatus(deps, libId);
    const semLine = formatSemanticStatusLine(semantic);
    // Self-diagnosis without file access (#247). Text too — Desktop strips structuredContent.
    const diag = diagnostics();
    const serverUrl = deps.config.serverUrl;

    if (pingError !== undefined) {
      return {
        isError: true,
        content: [{ type: "text", text: `Calibre unreachable: ${pingError}\n${semLine}\n${diag.text}` }],
        structuredContent: { ok: false, error: pingError, serverUrl, semantic, ...diag.structured },
      };
    }
    return toolText(`ok\n${(listOut ?? "").slice(0, 500)}\n${semLine}\n${diag.text}`, {
      ok: true,
      serverUrl,
      semantic,
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
