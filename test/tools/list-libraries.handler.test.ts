// calibre_list_libraries channel parity (#303): Claude Desktop shows the model only the text
// content, so every library ID and the default marker must be in the text, not just structuredContent.

import { describe, it, expect } from "vitest";
import { listLibrariesTool } from "../../src/tools/calibre_list_libraries.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolResult } from "../../src/tools/types.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

function deps(libraryMap: Record<string, string>, defaultLibrary: string): BaseDeps {
  const content = { libraryInfo: async () => ({ libraryMap, defaultLibrary }) };
  return {
    config: loadConfig({}),
    content: content satisfies Partial<ToolDeps["content"]> as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  };
}

const text = (r: ToolResult): string => r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

const MAP = {
  Programming_Books: "Programming Books",
  Humanities: "Humanities",
  Reaserch_Books: "Reaserch Books",
};

describe("calibre_list_libraries text channel (#303)", () => {
  it("renders one line per library with its id, marking only the default", async () => {
    const r = await listLibrariesTool.handler({}, deps(MAP, "Programming_Books"));
    const lines = text(r).split("\n");
    expect(lines).toContain("Programming Books (id: Programming_Books) [default]");
    expect(lines).toContain("Humanities (id: Humanities)");
    expect(lines).toContain("Reaserch Books (id: Reaserch_Books)");
    expect(text(r).match(/\[default\]/g)).toHaveLength(1);
  });

  it("marks a non-first library as default", async () => {
    const r = await listLibrariesTool.handler({}, deps(MAP, "Humanities"));
    const lines = text(r).split("\n");
    expect(lines).toContain("Humanities (id: Humanities) [default]");
    expect(lines).toContain("Programming Books (id: Programming_Books)");
  });

  it("mirrors every structured id and name into the text", async () => {
    const r = await listLibrariesTool.handler({}, deps(MAP, "Programming_Books"));
    const sc = r.structuredContent as { libraries: { id: string; name: string }[] };
    expect(sc.libraries).toHaveLength(3);
    for (const l of sc.libraries) {
      expect(text(r)).toContain(`${l.name} (id: ${l.id})`);
    }
  });

  it("still says (none) when the server exposes no libraries", async () => {
    const r = await listLibrariesTool.handler({}, deps({}, ""));
    expect(text(r)).toContain("(none)");
  });
});
