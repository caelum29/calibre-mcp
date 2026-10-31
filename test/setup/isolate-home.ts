// Keeps the unit suite off the developer's real data: default index/log dirs resolve from HOME,
// so a test that forgets CALIBRE_MCP_INDEX_DIR would write into ~/Library/Application Support
// (#252's shutdown.test.ts did). Opt-in live/model runs keep the real dirs to reuse the model cache.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const liveRun = Boolean(process.env.RUN_MODEL_TESTS || process.env.RUN_CALIBRE_TESTS);

if (!liveRun) {
  const home = mkdtempSync(path.join(tmpdir(), "calibre-mcp-home-"));
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = path.join(home, ".local", "share");
  process.env.CALIBRE_MCP_INDEX_DIR = path.join(home, "index");
  afterAll(() => rmSync(home, { recursive: true, force: true }));
}
