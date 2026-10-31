// loadRuntimeConfig must wire per-platform calibredb discovery (#261): without it, a GUI-launched
// macOS server with no Calibre on PATH silently falls back to a bare "calibredb" and fails.

import { describe, it, expect, vi } from "vitest";

const discovered: NodeJS.ProcessEnv[] = [];
vi.mock("../src/calibre/discover.js", () => ({
  discoverCalibredb: (env: NodeJS.ProcessEnv) => {
    discovered.push(env);
    return "/Applications/calibre.app/Contents/MacOS/calibredb";
  },
}));

const { loadRuntimeConfig } = await import("../src/runtime-config.js");

describe("loadRuntimeConfig", () => {
  it("should_use_the_discovered_calibredb_when_no_env_override_is_set", () => {
    discovered.length = 0;
    const env = { CALIBRE_MCP_INDEX_DIR: ":memory:" };
    expect(loadRuntimeConfig(env).calibredbPath).toBe("/Applications/calibre.app/Contents/MacOS/calibredb");
    expect(discovered).toEqual([env]);
  });

  it("should_let_an_explicit_CALIBRE_MCP_CALIBREDB_PATH_win_over_discovery", () => {
    discovered.length = 0;
    const cfg = loadRuntimeConfig({
      CALIBRE_MCP_CALIBREDB_PATH: "/opt/calibre/calibredb",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    });
    expect(cfg.calibredbPath).toBe("/opt/calibre/calibredb");
  });
});
