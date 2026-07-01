// Single source of truth for the server version: package.json, read relative to this
// module. The `../package.json` hop works from both src/ (tsx, vitest) and dist/
// (npm install, MCPB bundle) — package.json always sits one level above.

import { readFileSync } from "node:fs";

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
