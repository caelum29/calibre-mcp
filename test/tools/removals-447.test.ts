// #447: inputs/lines that were accepted-but-unimplemented are removed from the public contract.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import { findDuplicatesTool } from "../../src/tools/calibre_find_duplicates.js";
import { buildIndexTool } from "../../src/tools/calibre_build_index.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";
import { textOf } from "./text-of.js";

const fixture: Book[] = [
  { id: 1, uuid: "u", title: "X", authors: [], identifiers: {}, formats: [], tags: [], languages: [] },
];

function deps(): BaseDeps {
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async () => ({ bookIds: [1], total: 1, num: 1, offset: 0, sort: "title", libraryId: "Lib" }),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, fixture[0] ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  };
}

describe("calibre_quality_report has no readability input (#447)", () => {
  it("does not declare readability in its schema", () => {
    expect(Object.keys(qualityReportTool.inputSchema)).not.toContain("readability");
  });

  it("strips a caller-supplied readability (like any unknown input) and says nothing about it", async () => {
    const parsed = z.object(qualityReportTool.inputSchema).parse({ readability: true });
    expect(parsed).not.toHaveProperty("readability");
    const r = await qualityReportTool.handler(parsed, deps());
    expect(textOf(r)).not.toContain("readability");
  });
});

describe("calibre_find_duplicates result (#447)", () => {
  it("has no 'binary mode' / 'not implemented yet' line", async () => {
    const r = await findDuplicatesTool.handler({ mode: "identical", limit: 50 }, deps());
    expect(textOf(r)).not.toMatch(/binary mode|not implemented yet/);
  });
});

describe("calibre_build_index description (#447)", () => {
  it("does not say full-library indexing is deferred", () => {
    expect(buildIndexTool.description).not.toContain("deferred");
  });
});
