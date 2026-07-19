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

  it("reranking defaults ON; only an explicit off/false/0 opt-out disables it", () => {
    expect(loadConfig({}).rerankEnabled).toBe(true);
    for (const v of ["off", "false", "0", "OFF", "False"]) {
      expect(loadConfig({ CALIBRE_MCP_RERANK: v }).rerankEnabled).toBe(false);
    }
    // Blank and unrecognized values all mean ON — an escape hatch, not a gate (and never
    // z.coerce.boolean(): the parse is a falsy-check because unset must stay enabled).
    for (const v of ["", "   ", "on", "1", "yes", "banana"]) {
      expect(loadConfig({ CALIBRE_MCP_RERANK: v }).rerankEnabled).toBe(true);
    }
  });

  it("board style defaults to shelf; only an explicit coverflow switches (case-insensitive)", () => {
    expect(loadConfig({}).boardStyle).toBe("shelf");
    expect(loadConfig({ CALIBRE_MCP_BOARD_STYLE: "coverflow" }).boardStyle).toBe("coverflow");
    expect(loadConfig({ CALIBRE_MCP_BOARD_STYLE: " Coverflow " }).boardStyle).toBe("coverflow");
    // Desktop settings fields are user-typed — a value pasted with quotes must still work.
    expect(loadConfig({ CALIBRE_MCP_BOARD_STYLE: '"coverflow"' }).boardStyle).toBe("coverflow");
    expect(loadConfig({ CALIBRE_MCP_BOARD_STYLE: "'coverflow'" }).boardStyle).toBe("coverflow");
    // The Desktop bundle maps a boolean toggle onto this env var → "true"/"false".
    expect(loadConfig({ CALIBRE_MCP_BOARD_STYLE: "true" }).boardStyle).toBe("coverflow");
    expect(loadConfig({ CALIBRE_MCP_BOARD_STYLE: "false" }).boardStyle).toBe("shelf");
    // Blank, the plain default, and typos all mean shelf — a style pick, not a gate.
    for (const v of ["", "shelf", "covrflow", "banana"]) {
      expect(loadConfig({ CALIBRE_MCP_BOARD_STYLE: v }).boardStyle).toBe("shelf");
    }
  });

  it("lets an explicit calibredb path win even if the file does not exist", () => {
    const cfg = loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: "/nonexistent/calibredb" });
    expect(cfg.calibredbPath).toBe("/nonexistent/calibredb");
  });

  it("treats an un-interpolated MCPB placeholder as unset, not a literal path", () => {
    // A blank optional field with no manifest default can leak `${user_config.x}`.
    const cfg = loadConfig({
      CALIBRE_MCP_CALIBREDB_PATH: "${user_config.calibredb_path}",
      CALIBRE_MCP_LIBRARY: "${user_config.library}",
      CALIBRE_MCP_INDEX_DIR: "${user_config.index_dir}",
    });
    // Falls through to discovery / defaults instead of exec-ing the literal.
    expect(cfg.calibredbPath).not.toBe("${user_config.calibredb_path}");
    expect(cfg.defaultLibrary).toBe("");
    expect(cfg.indexDir).toContain("calibre-mcp");
  });
});
