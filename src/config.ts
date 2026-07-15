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
  /**
   * Cross-encoder rerank stage on semantic search (D-011). ON by default; the escape hatch
   * CALIBRE_MCP_RERANK=off/false/0 disables it (env-only — deliberately not a tool param).
   */
  rerankEnabled: boolean;
  /**
   * Max bytes to download for one book's format before refusing to extract it. Sized for the
   * SERVED payload, not the library file — the Content Server can hand back a far heavier copy
   * than what sits on disk (a 8 MB PDF served as 70 MB), so a disk-sized cap silently skips
   * large books. Override via CALIBRE_MCP_MAX_BOOK_BYTES.
   */
  maxBookBytes: number;
  /** Filesystem roots calibre_add_book may import from (path-whitelist, DESIGN §5). */
  addRoots: string[];
}

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Default-ON flag: only an explicit opt-out disables it (the inverse of `truthy` — this
 * one must be a falsy-check because unset means enabled). Never z.coerce.boolean().
 */
function notOptedOut(v: string | undefined): boolean {
  const t = envStr(v)?.toLowerCase();
  return !(t === "off" || t === "false" || t === "0");
}

/**
 * Unset/empty/whitespace env values are all "absent" — MCPB substitutes an empty
 * string for optional user_config fields the user left blank, and `"" ?? default`
 * would otherwise keep the empty string. A blank field with no `default` in the
 * manifest can instead leak the raw `${user_config.x}` placeholder un-substituted;
 * treat that as absent too so auto-detect fallbacks (discoverCalibredb, etc.) run.
 */
function envStr(v: string | undefined): string | undefined {
  const t = v?.trim();
  if (!t) return undefined;
  if (/^\$\{[^}]+\}$/.test(t)) return undefined; // un-interpolated MCPB placeholder
  return t;
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
  const maxBytes = Number(envStr(env.CALIBRE_MCP_MAX_BOOK_BYTES));
  return {
    serverUrl: envStr(env.CALIBRE_MCP_SERVER_URL) ?? "http://localhost:8080",
    defaultLibrary: envStr(env.CALIBRE_MCP_LIBRARY) ?? "",
    writeEnabled: truthy(env.CALIBRE_MCP_ENABLE_WRITE),
    // Explicit env path wins even if it doesn't exist (the user said so); else discover.
    calibredbPath: envStr(env.CALIBRE_MCP_CALIBREDB_PATH) ?? discoverCalibredb(env),
    indexDir: dataDir(env),
    semanticFloor: Number.isFinite(floor) ? floor : 0.78,
    rerankEnabled: notOptedOut(env.CALIBRE_MCP_RERANK),
    maxBookBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 256 * 1024 * 1024,
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
