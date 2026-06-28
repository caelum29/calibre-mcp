import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("defaults writes off and points at the local Content Server", () => {
    const cfg = loadConfig({});
    expect(cfg.writeEnabled).toBe(false);
    expect(cfg.serverUrl).toBe("http://localhost:8080");
    expect(cfg.defaultLibrary).toBe("Programming Books");
  });

  it("enables writes only for explicit truthy flags", () => {
    expect(loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "true" }).writeEnabled).toBe(true);
    expect(loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "1" }).writeEnabled).toBe(true);
    // Never treat the string "false" as true — the -32602 boolean trap.
    expect(loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "false" }).writeEnabled).toBe(false);
  });
});