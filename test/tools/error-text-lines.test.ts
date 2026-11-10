// #437: error results are text-only on both clients (Desktop always; Code on isError), so the
// error code and the remediation hint must ride in the text as labelled lines, not only in
// structuredContent.

import { describe, expect, it } from "vitest";
import { ERROR_CODES, defaultHint, type ErrorCode } from "../../src/domain/error-codes.js";
import { CalibreHttpError } from "../../src/domain/errors.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { allTools } from "../../src/tools/registry.js";
import { toolError } from "../../src/tools/result.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const text = (r: ToolResult): string => r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

const HINTED: ErrorCode[] = ERROR_CODES.filter((c) => defaultHint(c) !== undefined);
const UNHINTED: ErrorCode[] = ERROR_CODES.filter((c) => defaultHint(c) === undefined);

describe("toolError text carries Code: and Next: lines (#437)", () => {
  it("has hinted and unhinted codes to check", () => {
    expect({ hinted: HINTED.length, unhinted: UNHINTED.length > 0 }).toEqual({ hinted: 11, unhinted: true });
  });

  it.each(HINTED)("%s: text ends with its Code: line and its default hint as Next:", (code) => {
    expect(text(toolError(code, "boom"))).toBe(`Error: boom\nCode: ${code}\nNext: ${defaultHint(code)}`);
  });

  it.each(UNHINTED)("%s: text ends with its Code: line and no Next: line", (code) => {
    expect(text(toolError(code, "boom"))).toBe(`Error: boom\nCode: ${code}`);
  });

  it("uses the caller's own hint for Next:", () => {
    const r = toolError("not_found", "No such bundle", { hint: "list bundles with calibre_manage_bundles" });
    expect(text(r)).toBe("Error: No such bundle\nCode: not_found\nNext: list bundles with calibre_manage_bundles");
  });

  it("skips Next: when the message already contains the hint", () => {
    const r = toolError("index_missing", "No semantic index for Lib — run calibre_build_index first");
    expect(text(r)).toBe("Error: No semantic index for Lib — run calibre_build_index first\nCode: index_missing");
  });

  it("appends the lines after a bare message without the Error: prefix", () => {
    const r = toolError("calibre_unreachable", "Calibre unreachable: down\nserver: x", { bare: true });
    expect(text(r)).toBe(
      `Calibre unreachable: down\nserver: x\nCode: calibre_unreachable\nNext: ${defaultHint("calibre_unreachable")}`,
    );
  });

  it("keeps errorCode and hint in structuredContent", () => {
    expect(toolError("calibre_busy", "busy").structuredContent).toEqual({
      error: "busy",
      errorCode: "calibre_busy",
      hint: defaultHint("calibre_busy"),
    });
  });
});

describe("calibre_ping bare error path (#437)", () => {
  it("shows the code and the start-the-server step in the text when Calibre is down", async () => {
    const ping = allTools.find((t) => t.name === "calibre_ping");
    const d: ToolDeps = {
      config: loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" }),
      content: {
        resolveLibraryId: async () => {
          throw new CalibreHttpError(0, "http://127.0.0.1:9/ajax/library-info", "Cannot reach Calibre Content Server");
        },
      } as unknown as ToolDeps["content"],
      calibre: {} as ToolDeps["calibre"],
      extractor: {} as ToolDeps["extractor"],
      figures: {} as ToolDeps["figures"],
      embedder: { loadState: () => "not-attempted" } satisfies Partial<ToolDeps["embedder"]> as ToolDeps["embedder"],
      index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
      log,
    };
    const r = await ping!.handler({}, d);
    const lines = text(r).split("\n");
    expect({
      isError: r.isError,
      first: lines[0],
      tail: lines.slice(-2),
    }).toEqual({
      isError: true,
      first: "Calibre unreachable: Cannot reach Calibre Content Server",
      tail: ["Code: calibre_unreachable", `Next: ${defaultHint("calibre_unreachable")}`],
    });
  });
});
