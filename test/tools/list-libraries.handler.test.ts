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
});

// Stale default (#325): defaultLibrary is not a key of libraryMap, so no line can carry [default].
// Both channels must agree: no default is reported, and the text says why.
describe("calibre_list_libraries with a stale defaultLibrary (#325)", () => {
  it("marks no line [default], omits structured default, and says so in the text", async () => {
    const r = await listLibrariesTool.handler({}, deps(MAP, "Gone_Library"));
    const sc = r.structuredContent as { libraries: { isDefault: boolean }[]; default?: string };
    expect(text(r)).not.toContain("[default]");
    expect(sc.libraries.map((l) => l.isDefault)).toEqual([false, false, false]);
    expect(sc.default).toBeUndefined();
    expect(text(r).split("\n").at(-1)).toBe('Note: the server default "Gone_Library" is not an exposed library.');
  });
});

describe("calibre_list_libraries with no libraries (#325)", () => {
  it("says exactly (none) in the text and reports no default", async () => {
    const r = await listLibrariesTool.handler({}, deps({}, ""));
    expect(text(r)).toBe("Libraries: (none)");
    expect(r.structuredContent).toEqual({ libraries: [] });
  });
});

describe("calibre_list_libraries default handling, review round (#325)", () => {
  it("listed default: no Note line, structured default equals the id, no defaultUnavailable", async () => {
    const r = await listLibrariesTool.handler({}, deps(MAP, "Humanities"));
    const sc = r.structuredContent as { default?: string; defaultUnavailable?: string };
    expect(text(r)).not.toContain("Note:");
    expect(sc.default).toBe("Humanities");
    expect(sc.defaultUnavailable).toBeUndefined();
  });

  it("stale default: names it in defaultUnavailable and steers to an explicit id", async () => {
    const r = await listLibrariesTool.handler({}, deps(MAP, "Gone_Library"));
    const sc = r.structuredContent as { defaultUnavailable?: string };
    expect(sc.defaultUnavailable).toBe("Gone_Library");
    expect(text(r)).toContain("Pass an explicit library id from this list");
  });

  it("zero libraries + stale default: (none) plus the Note, defaultUnavailable set", async () => {
    const r = await listLibrariesTool.handler({}, deps({}, "Gone_Library"));
    expect(text(r)).toBe('Libraries: (none)\nNote: the server default "Gone_Library" is not an exposed library.');
    expect(r.structuredContent).toStrictEqual({ libraries: [], defaultUnavailable: "Gone_Library" });
  });
});
