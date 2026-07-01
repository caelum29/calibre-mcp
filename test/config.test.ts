import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("defaults writes off and points at the local Content Server", () => {
    const cfg = loadConfig({});
    expect(cfg.writeEnabled).toBe(false);
    expect(cfg.serverUrl).toBe("http://localhost:8080");
    // Empty = auto-detect the server's default library at first use.
    expect(cfg.defaultLibrary).toBe("");
  });

  it("enables writes only for explicit truthy flags", () => {
    expect(loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "true" }).writeEnabled).toBe(true);
    expect(loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "1" }).writeEnabled).toBe(true);
    // Never treat the string "false" as true — the -32602 boolean trap.
    expect(loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "false" }).writeEnabled).toBe(false);
  });

  it("treats empty/whitespace env values as unset (MCPB substitutes empty strings)", () => {
    const cfg = loadConfig({
      CALIBRE_MCP_SERVER_URL: "",
      CALIBRE_MCP_LIBRARY: "   ",
      CALIBRE_MCP_CALIBREDB_PATH: "",
      CALIBRE_MCP_SEMANTIC_FLOOR: "",
      CALIBRE_MCP_INDEX_DIR: " ",
    });
    expect(cfg.serverUrl).toBe("http://localhost:8080");
    expect(cfg.defaultLibrary).toBe("");
    expect(cfg.semanticFloor).toBe(0.78);
    expect(cfg.calibredbPath).not.toBe("");
    expect(cfg.indexDir).toContain("calibre-mcp");
  });

  it("lets an explicit calibredb path win even if the file does not exist", () => {
    const cfg = loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: "/nonexistent/calibredb" });
    expect(cfg.calibredbPath).toBe("/nonexistent/calibredb");
  });
});
