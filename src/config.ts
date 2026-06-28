// Runtime configuration read from env. No hard-coded secrets (DESIGN §7);
// writes are gated off by default and only enabled via an explicit flag.

export interface Config {
  /** Content Server base URL the running Calibre GUI exposes (reads + routed writes). */
  serverUrl: string;
  /** Default library name within the Content Server (the `#Lib` fragment). */
  defaultLibrary: string;
  /** Master write gate. Off unless CALIBRE_MCP_ENABLE_WRITE is truthy. */
  writeEnabled: boolean;
  /** Path to the calibredb binary (aliased on this machine inside calibre.app). */
  calibredbPath: string;
}

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    serverUrl: env.CALIBRE_MCP_SERVER_URL ?? "http://localhost:8080",
    defaultLibrary: env.CALIBRE_MCP_LIBRARY ?? "Programming Books",
    writeEnabled: truthy(env.CALIBRE_MCP_ENABLE_WRITE),
    calibredbPath:
      env.CALIBRE_MCP_CALIBREDB_PATH ??
      "/Applications/calibre.app/Contents/MacOS/calibredb",
  };
}