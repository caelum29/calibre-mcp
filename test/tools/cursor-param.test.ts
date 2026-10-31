// #325 §Cursors: a non-string `cursor` must never reach the SDK as a -32602. CursorParam coerces it to a
// string, and the handler then answers with an actionable invalid_input error (return-not-throw).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { CursorParam } from "../../src/tools/coerce.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import { findDuplicatesTool } from "../../src/tools/calibre_find_duplicates.js";
import type { ToolDeps } from "../../src/tools/deps.js";

describe("CursorParam coercion (#325)", () => {
  it("passes a string and undefined through unchanged", () => {
    expect(CursorParam.parse("abc")).toBe("abc");
    expect(CursorParam.parse(undefined)).toBeUndefined();
  });

  it("coerces a number to its string form", () => {
    expect(CursorParam.parse(40)).toBe("40");
  });

  it("coerces an object to its JSON string", () => {
    expect(CursorParam.parse({ offset: 40, query: "x" })).toBe('{"offset":40,"query":"x"}');
  });
});

const deps = {
  config: loadConfig({}),
  content: { resolveLibraryId: async () => "Lib" } as unknown as ToolDeps["content"],
  calibre: {} as ToolDeps["calibre"],
  extractor: {} as ToolDeps["extractor"],
  figures: {} as ToolDeps["figures"],
  embedder: {} as ToolDeps["embedder"],
  index: {} as ToolDeps["index"],
  log,
} satisfies ToolDeps;

describe("non-string cursor through the real tool schema + handler (#325)", () => {
  it.each([[40], [{ offset: 40, query: "x" }]])("quality_report cursor %j → invalid_input", async (cursor) => {
    const parsed = z.object(qualityReportTool.inputSchema).parse({ cursor });
    const r = await qualityReportTool.handler(parsed, deps);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ errorCode: "invalid_input" });
    expect(r.structuredContent?.error).toMatch(/^Invalid cursor for calibre_quality_report/);
  });

  it("find_duplicates number cursor → invalid_input", async () => {
    const parsed = z.object(findDuplicatesTool.inputSchema).parse({ mode: "identical", cursor: 40 });
    const r = await findDuplicatesTool.handler(parsed, deps);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ errorCode: "invalid_input" });
    expect(r.structuredContent?.error).toMatch(/^Invalid cursor for calibre_find_duplicates/);
  });
});
