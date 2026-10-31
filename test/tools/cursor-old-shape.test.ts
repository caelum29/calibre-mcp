// #325 §Cursors: a pre-#305 cursor ({offset, query}, no version/binding) through the real
// quality_report and find_duplicates handlers must get the actionable "Invalid cursor" error,
// not a silent restart or an offset applied to the wrong result set.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import { findDuplicatesTool } from "../../src/tools/calibre_find_duplicates.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

const enc = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
const OLD_SHAPE = enc({ offset: 2, query: "title" });
const V1_SHAPE = enc({ v: 1, offset: 2, libId: "Lib", mode: "quality", query: "" });

const deps: BaseDeps = {
  config: loadConfig({}),
  content: {
    resolveLibraryId: async () => "Lib",
    search: async () => ({ bookIds: [1, 2, 3], total: 3, num: 3, offset: 0, sort: "title", libraryId: "Lib" }),
    booksByIds: async (ids: number[]) =>
      new Map(
        ids.map((id) => [
          id,
          {
            id,
            uuid: `u${id}`,
            title: `T${id}`,
            authors: ["A"],
            identifiers: {},
            formats: [],
            tags: [],
            languages: [],
          },
        ]),
      ),
  } as unknown as ToolDeps["content"],
  calibre: {} as ToolDeps["calibre"],
  extractor: {} as ToolDeps["extractor"],
  figures: {} as ToolDeps["figures"],
  embedder: {} as ToolDeps["embedder"],
  log,
};

const ACTIONABLE = (tool: string) =>
  `Invalid cursor for ${tool} — pass the exact nextCursor token from the previous response (it is opaque). ` +
  `Cursors minted before a server upgrade are no longer valid: rerun ${tool} without cursor to start from the first page.`;

describe("old-shape cursors through the real handlers (#325)", () => {
  it.each([
    ["old {offset, query}", OLD_SHAPE],
    ["version 1", V1_SHAPE],
  ])("quality_report refuses a %s cursor with the actionable error", async (_n, cursor) => {
    const r = await qualityReportTool.handler({ limit: 2, cursor } as never, deps);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: "invalid_input",
      error: ACTIONABLE("calibre_quality_report"),
    });
    expect(r.structuredContent?.nextCursor).toBeUndefined();
  });

  it.each([
    ["old {offset, query}", OLD_SHAPE],
    ["version 1", V1_SHAPE],
  ])("find_duplicates refuses a %s cursor with the actionable error", async (_n, cursor) => {
    const r = await findDuplicatesTool.handler({ mode: "identical", limit: 2, cursor } as never, deps);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: "invalid_input",
      error: ACTIONABLE("calibre_find_duplicates"),
    });
    expect(r.structuredContent?.nextCursor).toBeUndefined();
  });
});
