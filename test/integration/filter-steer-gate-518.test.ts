// #518: each of the six filter-taking tools words the unknown-bundle steer for the CURRENT write gate
// (a hard-coded `true`/`false` in one tool must fail here).
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { log } from "../../src/logging.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import { semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import { findDuplicatesTool } from "../../src/tools/calibre_find_duplicates.js";
import type { AnyToolDescriptor } from "../../src/tools/types.js";

const SAVED = 'Integration status: False\nName: Rust\nSearch string: tags:"=Rust"\n';
const FACT = 'Unknown bundle "Golang". Available bundles: Rust.';
const GATE_OFF =
  'List them with calibre_manage_bundles { action: "list" }; creating one needs writes enabled (CALIBRE_MCP_ENABLE_WRITE).';
const GATE_ON = 'Create one with calibre_manage_bundles { action: "create" }.';

const deps = (writeEnabled: boolean) =>
  ({
    config: loadConfig(writeEnabled ? { CALIBRE_MCP_ENABLE_WRITE: "1" } : {}),
    content: {
      resolveLibraryId: async () => "Lib518",
      virtualLibraries: async () => ({}),
      search: async () => ({ total: 0, bookIds: [], libraryId: "Lib518" }),
    },
    calibre: {
      calibreVersion: async () => parseCalibreVersion("calibredb (calibre 9.18)"),
      calibredb: async () => ({ stdout: SAVED, stderr: "" }),
    },
    extractor: {},
    figures: {},
    embedder: {},
    // semantic_search reads these before it resolves the filter
    index: { hasIndex: () => true, indexMeta: () => undefined, hasVectors: () => true },
    log,
  }) as never;

const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((b) => b.text ?? "").join("\n");

const TOOLS: Array<[string, AnyToolDescriptor, Record<string, unknown>]> = [
  ["calibre_search meta", searchTool as never, { query: "x", mode: "meta", scope: "library", limit: 5 }],
  ["calibre_search annotations", searchTool as never, { query: "x", mode: "annotations", scope: "library", limit: 5 }],
  ["calibre_semantic_search", semanticSearchTool as never, { query: "x", scope: "library", limit: 5 }],
  ["calibre_bulk_update", bulkUpdateTool as never, { query: "x", changes: { title: "t" } }],
  ["calibre_quality_report", qualityReportTool as never, { limit: 5 }],
  ["calibre_find_duplicates", findDuplicatesTool as never, { limit: 5 }],
];

describe("unknown-bundle steer follows the gate in every filter-taking tool (#518)", () => {
  it.each(TOOLS)("should_word_the_steer_for_the_current_gate_in_%s", async (_n, tool, args) => {
    const out: string[] = [];
    for (const on of [false, true]) {
      invalidateBundleCache();
      const r = await (
        tool as unknown as { handler: (a: unknown, d: unknown) => Promise<Parameters<typeof text>[0]> }
      ).handler({ ...args, filter: "Golang" }, deps(on));
      out.push(text(r));
    }
    expect(out).toEqual([`${FACT} ${GATE_OFF}`, `${FACT} ${GATE_ON}`].map((t) => expect.stringContaining(t)));
  });
});
