// Composition-level config: loadConfig plus real calibredb discovery. Lives above config.ts
// so the core config stays free of adapters (#261); real processes (server, scripts) use this.

import { loadConfig, type Config } from "./config.js";
import { discoverCalibredb } from "./calibre/discover.js";

/** Load the server config with per-platform calibredb auto-discovery wired in. */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadConfig(env, discoverCalibredb);
}
