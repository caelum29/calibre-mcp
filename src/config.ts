// Runtime configuration read from env. No hard-coded secrets (DESIGN §7);
// writes are gated off by default and only enabled via an explicit flag.

import { homedir } from "node:os";
import path from "node:path";
import { discoverCalibredb } from "./calibre/discover.js";

export interface Config {
  /** Content Server base URL the running Calibre GUI exposes (reads + routed writes). */
  serverUrl: string;
  /** Library name within the Content Server. Empty = auto-detect the server's default. */
  defaultLibrary: string;
  /** Master write gate. Off unless CALIBRE_MCP_ENABLE_WRITE is truthy. */
  writeEnabled: boolean;
  /** Path to the calibredb binary (auto-discovered per platform; see calibre/discover.ts). */
  calibredbPath: string;
  /**
   * Persistent dir for the semantic index (SQLite) and the transformers.js model cache.
   * A DATA dir, not tmp — the index is expensive to build and must survive reboots.
   */
  indexDir: string;
  /** Min cosine score below which semantic results are flagged low-confidence. */
  semanticFloor: number;
  /** Filesystem roots calibre_add_book may import from (path-whitelist, DESIGN §5). */
  addRoots: string[];
}

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Unset/empty/whitespace env values are all "absent" — MCPB substitutes an empty
 * string for optional user_config fields the user left blank, and `"" ?? default`
 * would otherwise keep the empty string.
 */
function envStr(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** Platform data dir (persists across reboots), honoring XDG / APPDATA where set. */
function dataDir(env: NodeJS.ProcessEnv): string {
  const explicit = envStr(env.CALIBRE_MCP_INDEX_DIR);
  if (explicit) return explicit;
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
  const floor = Number(envStr(env.CALIBRE_MCP_SEMANTIC_FLOOR));
  return {
    serverUrl: envStr(env.CALIBRE_MCP_SERVER_URL) ?? "http://localhost:8080",
    defaultLibrary: envStr(env.CALIBRE_MCP_LIBRARY) ?? "",
    writeEnabled: truthy(env.CALIBRE_MCP_ENABLE_WRITE),
    // Explicit env path wins even if it doesn't exist (the user said so); else discover.
    calibredbPath: envStr(env.CALIBRE_MCP_CALIBREDB_PATH) ?? discoverCalibredb(env),
    indexDir: dataDir(env),
    semanticFloor: Number.isFinite(floor) ? floor : 0.78,
    addRoots: addRoots(env),
  };
}

/**
 * Roots calibre_add_book may import files from. Overridable via CALIBRE_MCP_ADD_ROOTS
 * (`path.delimiter`-separated); defaults to the user's documents + download folders. A
 * file outside every root is refused (symlink-resolved boundary check, DESIGN §5).
 */
function addRoots(env: NodeJS.ProcessEnv): string[] {
  const raw = envStr(env.CALIBRE_MCP_ADD_ROOTS);
  const roots = raw
    ? raw.split(path.delimiter).filter(Boolean)
    : [path.join(homedir(), "Documents"), path.join(homedir(), "Downloads")];
  return roots.map((r) => path.resolve(r));
}
