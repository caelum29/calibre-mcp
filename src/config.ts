// Runtime configuration read from env. No hard-coded secrets (DESIGN §7);
// writes are gated off by default and only enabled via an explicit flag.

import { homedir } from "node:os";
import path from "node:path";

export interface Config {
  /** Content Server base URL the running Calibre GUI exposes (reads + routed writes). */
  serverUrl: string;
  /** Default library name within the Content Server (the `#Lib` fragment). */
  defaultLibrary: string;
  /** Master write gate. Off unless CALIBRE_MCP_ENABLE_WRITE is truthy. */
  writeEnabled: boolean;
  /** Path to the calibredb binary (aliased on this machine inside calibre.app). */
  calibredbPath: string;
  /**
   * Persistent dir for the semantic index (SQLite) and the transformers.js model cache.
   * A DATA dir, not tmp — the index is expensive to build and must survive reboots.
   */
  indexDir: string;
  /** Min cosine score below which semantic results are flagged low-confidence. */
  semanticFloor: number;
}

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** Platform data dir (persists across reboots), honoring XDG / APPDATA where set. */
function dataDir(env: NodeJS.ProcessEnv): string {
  if (env.CALIBRE_MCP_INDEX_DIR) return env.CALIBRE_MCP_INDEX_DIR;
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "calibre-mcp", "index");
  }
  if (process.platform === "win32" && env.APPDATA) {
    return path.join(env.APPDATA, "calibre-mcp", "index");
  }
  const xdg = env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
  return path.join(xdg, "calibre-mcp", "index");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const floor = Number(env.CALIBRE_MCP_SEMANTIC_FLOOR);
  return {
    serverUrl: env.CALIBRE_MCP_SERVER_URL ?? "http://localhost:8080",
    defaultLibrary: env.CALIBRE_MCP_LIBRARY ?? "Programming Books",
    writeEnabled: truthy(env.CALIBRE_MCP_ENABLE_WRITE),
    calibredbPath:
      env.CALIBRE_MCP_CALIBREDB_PATH ??
      "/Applications/calibre.app/Contents/MacOS/calibredb",
    indexDir: dataDir(env),
    semanticFloor: Number.isFinite(floor) ? floor : 0.78,
  };
}
