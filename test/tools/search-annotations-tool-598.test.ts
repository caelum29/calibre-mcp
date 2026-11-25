// #598 (ADR-0035): highlights and item notes live in their own tool, calibre_search_annotations,
// selected by `kind`. Red first: the tool must exist in the registry and answer like the old modes did.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { log } from "../../src/logging.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";
import { allTools } from "../../src/tools/registry.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const FIX = path.join(import.meta.dirname, "../calibre/fixtures/annotations-notes-500");
const raw = (name: string) => readFileSync(path.join(FIX, `${name}.raw`), "utf8");

function deps() {
  invalidateBundleCache();
  const calls: string[][] = [];
  const d = {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      virtualLibraries: async () => ({}),
      search: async () => ({ total: 7, bookIds: [], libraryId: "Programming_Books" }),
    } as unknown as ToolDeps["content"],
    calibre: {
      calibreVersion: async () => parseCalibreVersion("calibredb (calibre 9.18)"),
      calibredb: async (args: readonly string[]) => {
        calls.push([...args]);
        return { stdout: args[0] === "saved_searches" ? "" : raw("annotations-search-commit"), stderr: "" };
      },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  } as unknown as ToolDeps;
  return { d, calls };
}

describe("calibre_search_annotations (#598)", () => {
  it("should_be_registered_as_a_read_only_tool_without_a_board_widget", () => {
    const tool = allTools.find((t) => t.name === "calibre_search_annotations");
    expect(tool?.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(tool?.write).toBeUndefined();
  });

  it("should_take_exactly_the_agreed_inputs_without_cursor_or_sort", () => {
    const tool = allTools.find((t) => t.name === "calibre_search_annotations");
    expect(Object.keys(tool?.inputSchema ?? {}).sort()).toEqual(
      ["bookId", "countOnly", "filter", "include_excluded", "kind", "library", "limit", "query", "scope"].sort(),
    );
  });

  it("should_answer_a_highlight_search_with_the_output_of_the_old_annotations_mode", async () => {
    const tool = allTools.find((t) => t.name === "calibre_search_annotations");
    const f = deps();
    const r = await tool!.handler(
      { query: "commit", kind: "annotations", scope: "library", limit: 20, include_excluded: true },
      f.d,
    );
    expect(f.calls.filter((c) => c[0] !== "saved_searches")).toEqual([
      ["annotations", "search", "commit", "--format", "json"],
    ]);
    const sc = r.structuredContent as { mode: string; annotations: { id: number }[] };
    expect({ mode: sc.mode, ids: sc.annotations.map((a) => a.id) }).toEqual({ mode: "annotations", ids: [23, 16] });
  });
});
