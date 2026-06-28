import { describe, it, expect } from "vitest";
import { allTools } from "../../src/tools/registry.js";

describe("tool registry", () => {
  it("namespaces every tool under calibre_", () => {
    for (const t of allTools) expect(t.name.startsWith("calibre_")).toBe(true);
  });
  it("has unique tool names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("marks calibre_update_book as the gated write tool", () => {
    const writes = allTools.filter((t) => t.write).map((t) => t.name);
    expect(writes).toEqual(["calibre_update_book"]);
  });
});
