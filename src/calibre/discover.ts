// Cross-platform calibredb discovery: well-known install locations per OS, then PATH.
// Never throws — a missing binary must surface as an actionable error at use time
// (CalibreClient), not crash the server at boot (DISTRIBUTION: safe for strangers).

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MAC_BUNDLE = ["calibre.app", "Contents", "MacOS", "calibredb"];

/** Well-known install paths for the platform (env-var roots on Windows may be unset). */
function candidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return [
      path.join("/Applications", ...MAC_BUNDLE),
      path.join(homedir(), "Applications", ...MAC_BUNDLE),
    ];
  }
  if (platform === "win32") {
    return [
      env.ProgramFiles && path.join(env.ProgramFiles, "Calibre2", "calibredb.exe"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Calibre2", "calibredb.exe"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Calibre2", "calibredb.exe"),
    ].filter((p): p is string => Boolean(p));
  }
  return ["/usr/bin/calibredb", "/usr/local/bin/calibredb", "/opt/calibre/calibredb"];
}

/**
 * Locate the calibredb binary: first existing well-known path, else the bare name
 * so execFile resolves it from PATH (libuv appends `.exe` on Windows). The
 * CALIBRE_MCP_CALIBREDB_PATH env override is applied by loadConfig, not here.
 */
export function discoverCalibredb(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
): string {
  for (const c of candidates(env, platform)) if (exists(c)) return c;
  return "calibredb";
}
