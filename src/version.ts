// Single source of truth for the server version: package.json, read relative to this
// module. The `../package.json` hop works from both src/ (tsx, vitest) and dist/
// (npm install, MCPB bundle) — package.json always sits one level above.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION: string = readVersion();

/**
 * Installed MCP SDK version, read from its package.json by walking node_modules (the SDK's
 * `exports` map hides it from require.resolve, and tool code must not import the SDK).
 * "unknown" if it can't be found — ping must never fail on this.
 */
function readSdkVersion(): string {
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (;;) {
    try {
      const raw = readFileSync(
        path.join(dir, "node_modules", "@modelcontextprotocol", "server", "package.json"),
        "utf8",
      );
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      return typeof version === "string" ? version : "unknown";
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return "unknown";
      dir = parent;
    }
  }
}

export const SDK_VERSION: string = readSdkVersion();
