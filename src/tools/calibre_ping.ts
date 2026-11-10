// calibre_ping — connectivity probe that proves the SUBPROCESS path (calibredb --with-library
// URL) works, complementary to calibre_list_libraries (HTTP /ajax). Also carries the
// semantic-search self-diagnosis (#48), the server's recent errors + log file (#247), the
// libraries the busy breaker is failing fast (calibre/busy.ts), index coverage (app/library-index.ts)
// and whether Calibre itself accepts writes (#439: our gate alone can say ENABLED while Calibre refuses).

import { defineTool } from "./define.js";
import { toolError, toolText } from "./result.js";
import { computeSemanticStatus, formatSemanticStatusLine, type StatusIndex } from "../semantic/status.js";
import { libraryIndexReport, type LibraryIndex } from "../app/library-index.js";
import { capString, log } from "../logging.js";
import type { BusyLibrary } from "../calibre/busy.js";
import type { LibId } from "../calibre/lib-id.js";
import { CalibreBusyError, UnknownLibraryError } from "../domain/errors.js";
import { SDK_VERSION, VERSION } from "../version.js";
import type { BaseDeps, DepsWithIndex } from "./deps.js";
import type { ToolResult } from "./types.js";
import { defaultHint, errorCodeFor } from "../domain/error-codes.js";
import type { WriteAccessProbe } from "../domain/write-access.js";
import { labelledLine, PING_LINE_LABELS } from "./labelled-lines.js";

// the write probe runs alongside the index section, inside the same short budget
const WRITE_PROBE_TIMEOUT_MS = 5000;

/** calibre_ping's deps (#272): its index reads are exactly the semantic-status ones. */
export type PingDeps = DepsWithIndex<StatusIndex>;

export const pingTool = defineTool({
  name: "calibre_ping",
  title: "Calibre ping",
  description:
    "Health check: confirms the server reaches Calibre via calibredb and whether Calibre accepts writes; " +
    "reports semantic-search status, per-library index coverage, version, write gate, busy libraries, " +
    "recent errors and the log file path.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (_args, deps: PingDeps): Promise<ToolResult> => {
    // Resolve the libId (needed for both calibredb and the index vector count) first —
    // --with-library needs the ID, not the display name. A failure here is non-fatal to the
    // semantic diagnosis (it reads local disk/state), so keep it and still report semantics.
    let libId: LibId | undefined;
    let pingError: string | undefined;
    let configError: string | undefined; // an unknown CALIBRE_MCP_LIBRARY (#438)
    let pingCause: unknown;
    try {
      libId = await deps.content.resolveLibraryId();
      // reachability probe only; its raw category dump is noise, so it is not echoed (#304)
      await deps.calibre.listLibraries(libId);
    } catch (err) {
      // library-info answered, so Calibre is reachable: a bad CALIBRE_MCP_LIBRARY is a config fault.
      if (err instanceof UnknownLibraryError) configError = err.message;
      else {
        pingError = err instanceof Error ? err.message : String(err);
        pingCause = err;
      }
      // Busy is a known, self-clearing state (reported below), not a server fault.
      if (err instanceof CalibreBusyError) deps.log.warn("ping refused: library busy", { libraryId: err.libraryId });
      else if (configError !== undefined) deps.log.warn("ping: unknown default library", { error: configError });
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
    // probe Calibre's write gate only when it answered for a known library
    const probeLib = pingError === undefined && configError === undefined ? libId : undefined;
    // a busy library is reachable but refused for now: say so, not "unreachable" (#437 follow-up)
    const busyLib = pingCause instanceof CalibreBusyError;
    const skipped = pingError === undefined ? undefined : busyLib ? "library busy" : "Calibre unreachable";
    const [index, writeProbe] = await Promise.all([
      indexSection(deps, skipped),
      probeLib === undefined
        ? undefined
        : deps.content.probeWriteAccess(probeLib, { timeoutMs: WRITE_PROBE_TIMEOUT_MS }),
    ]);
    const facts = serverFacts(deps, index.indexes);

    // A failed ping leads with its own headline, then the same sections as a healthy report.
    const failed = (headline: string, error: string) => ({
      text: `${headline}: ${error}\n${header}\n${busy.text}${semLine}\n${index.line}\n${diag.text}`,
      structured: { ok: false, error, serverUrl, ...facts, semantic, ...busy.structured, ...diag.structured },
    });
    if (pingError !== undefined) {
      const f = failed(busyLib ? "Calibre busy" : "Calibre unreachable", pingError);
      return toolError(errorCodeFor(pingCause), f.text, { bare: true, structured: f.structured });
    }
    if (configError !== undefined) {
      const f = failed("Calibre reachable, but", configError);
      return toolError("not_found", f.text, { bare: true, structured: f.structured });
    }
    const writeAccess = writeProbe === undefined ? "" : writeAccessText(writeProbe, deps.config.writeEnabled);
    return toolText(`ok\n${header}\n${writeAccess}${busy.text}${semLine}\n${index.line}\n${diag.text}`, {
      ok: true,
      serverUrl,
      ...facts,
      ...(writeProbe === undefined ? {} : { calibreWriteAccess: writeProbe.access }),
      semantic,
      ...busy.structured,
      ...diag.structured,
    });
  },
});

/**
 * Recent server-side errors (oldest first, repeats collapsed with a count) + today's log file. Reads the process logger,
 * not deps.log: the ring buffer and file sink live only there (deps.log is the narrow sink).
 */
function diagnostics(): { text: string; structured: Record<string, unknown> } {
  const recentErrors = log.recentErrors().map((r) => ({
    ts: r.ts,
    msg: r.msg,
    ...(r.tool ? { tool: r.tool, call: r.call } : {}),
    ...(r.meta === undefined ? {} : { meta: r.meta }),
    count: r.count,
    ...(r.firstTs ? { firstTs: r.firstTs } : {}),
  }));
  const logFile = log.currentFile();
  const total = recentErrors.reduce((n, e) => n + e.count, 0);
  const lines = [
    `log file: ${logFile ?? "off (stderr only)"}`,
    `recent errors: ${recentErrors.length}${total > recentErrors.length ? ` (${total} occurrences)` : ""}`,
  ];
  // All of them, newest first — Desktop reads only this text, so it must match structuredContent.
  for (const e of [...recentErrors].reverse()) {
    const meta = e.meta === undefined ? "" : ` ${capString(JSON.stringify(e.meta), 200)}`;
    const repeats = e.firstTs ? ` (×${e.count} since ${e.firstTs})` : "";
    lines.push(`- ${e.ts}${e.tool ? ` [${e.tool} call=${e.call}]` : ""} ${e.msg}${meta}${repeats}`);
  }
  return { text: lines.join("\n"), structured: { logFile, recentErrors } };
}

/** Busy-breaker state as one text line per library (empty when none) + its structured mirror. */
function busyReport(list: BusyLibrary[]): { text: string; structured: Record<string, unknown> } {
  if (list.length === 0) return { text: "", structured: {} };
  const lines = list.map(
    (b) =>
      `busy: library "${b.libraryId}" — Calibre timed out (${b.source}) at ${b.since}; ` +
      (b.retryInMs > 0
        ? `calls fail fast for ~${Math.ceil(b.retryInMs / 1000)} s more`
        : `window ended, a probe call is checking whether it answers again`),
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

/**
 * Calibre's write gate as a labelled line (+ a mismatch warning when our gate is on but Calibre
 * refuses: every write tool would fail). `unknown` names its reason and claims nothing.
 */
function writeAccessText(p: WriteAccessProbe, gateOn: boolean): string {
  const value =
    p.access === "unknown"
      ? `unknown (${p.reason})`
      : p.access === "refused"
        ? 'refused — enable "Allow un-authenticated local connections to make changes" (Preferences → Sharing over the net)'
        : "allowed";
  const lines = [labelledLine(PING_LINE_LABELS.calibreWrites, value)];
  if (gateOn && p.access === "refused") {
    lines.push(
      "warning: CALIBRE_MCP_ENABLE_WRITE is on, but Calibre refuses writes — every write tool will fail until that setting is enabled",
    );
  }
  return `${lines.join("\n")}\n`;
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
 * The index section as one text line + its structured array. With Calibre down or the library
 * busy, the report is skipped with that reason: libraryInfo would just burn another full timeout.
 */
async function indexSection(deps: PingDeps, skipped?: string): Promise<{ line: string; indexes?: LibraryIndex[] }> {
  const label = (value: string) => labelledLine(PING_LINE_LABELS.index, value);
  if (skipped !== undefined) return { line: label(`skipped — ${skipped}`) };
  const indexes = await libraryIndexReport(deps);
  if (!indexes) return { line: label("libraries unavailable") };
  if (indexes.length === 0) return { line: label("(no libraries)"), indexes };
  // the text stays bounded however many libraries there are; structuredContent keeps them all (#442)
  const shown = cappedWithDefault(indexes).map(indexEntry);
  const more = indexes.length - shown.length;
  if (more > 0) shown.push(`… +${more} more — full list in structuredContent / calibre_list_libraries`);
  return { line: label(shown.join(" · ")), indexes };
}

/** Libraries listed in the Index text before it says "+K more" (#442). */
const INDEX_TEXT_CAP = 20;

/**
 * The first INDEX_TEXT_CAP libraries in map order, but never without the default: the Semantic
 * search line describes it, so its `[default]` entry must stay in the text (#440 review).
 */
function cappedWithDefault(indexes: LibraryIndex[]): LibraryIndex[] {
  const head = indexes.slice(0, INDEX_TEXT_CAP);
  if (head.some((i) => i.isDefault)) return head;
  const def = indexes.find((i) => i.isDefault);
  return def ? [...head.slice(0, INDEX_TEXT_CAP - 1), def] : head;
}

/** One `Index:` entry: `Name (id: Lib_Id) [default]: <state>` — tools take the id, not the name (#440). */
function indexEntry(i: LibraryIndex): string {
  const head = `${i.name} (id: ${i.id})${i.isDefault ? " [default]" : ""}`;
  switch (i.state) {
    case "ok":
      return `${head}: ${i.indexed}/${i.total ?? "?"} indexed${i.withoutEmbeddings ? ` (${i.withoutEmbeddings} without embeddings)` : ""}`;
    case "none":
      return `${head}: none`;
    case "stale":
      return `${head}: stale index (rebuild)`;
    case "conflict":
      return `${head}: not indexable — id "${i.id}" differs only in case from "${i.conflictsWith}", which was indexed first; rename the "${i.id}" library folder`;
    case "busy":
      return `${head}: busy — index locked by another process, retry`;
    default:
      return `${head}: index unreadable`;
  }
}
