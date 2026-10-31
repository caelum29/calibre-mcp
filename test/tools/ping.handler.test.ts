// calibre_ping as a registry descriptor (#222): health check over the calibredb subprocess
// path plus the semantic-status and self-diagnosis blocks, unit-tested with fakes.

import { describe, it, expect } from "vitest";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { CalibreBusyError } from "../../src/domain/errors.js";
import type { AnyToolDescriptor } from "../../src/tools/types.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const SERVER_URL = "http://127.0.0.1:9";

function pingTool(): AnyToolDescriptor {
  const t = allTools.find((x) => x.name === "calibre_ping");
  if (!t) throw new Error("calibre_ping is not in the registry");
  return t;
}

function deps(o: { resolveLibraryId?: () => Promise<string>; listLibraries?: (lib?: string) => Promise<string> }) {
  const listCalls: Array<string | undefined> = [];
  const d: ToolDeps = {
    config: loadConfig({ CALIBRE_MCP_SERVER_URL: SERVER_URL, CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: {
      resolveLibraryId: o.resolveLibraryId ?? (async () => "Programming_Books"),
    } as unknown as ToolDeps["content"],
    calibre: {
      listLibraries: async (lib?: string) => {
        listCalls.push(lib);
        return (o.listLibraries ?? (async () => "category,count\ntags,12"))(lib);
      },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
    index: { indexMeta: () => undefined, hasIndex: () => false } as unknown as ToolDeps["index"],
    log,
  };
  return { d, listCalls };
}

function text(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content.map((b) => b.text ?? "").join("\n");
}

describe("calibre_ping handler", () => {
  it("should_be_registered_read_only_with_an_empty_input_schema", () => {
    const t = pingTool();
    expect({ inputSchema: t.inputSchema, annotations: t.annotations, write: t.write }).toEqual({
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      write: undefined,
    });
  });

  it("should_be_registered_last_so_tools_list_order_is_unchanged", () => {
    expect(allTools.at(-1)?.name).toBe("calibre_ping");
  });

  it("should_report_ok_with_the_categories_for_the_resolved_library_id", async () => {
    const { d, listCalls } = deps({});
    const r = await pingTool().handler({}, d);
    expect(r.isError).toBeUndefined();
    expect(listCalls).toEqual(["Programming_Books"]);
    expect(text(r)).toMatch(/^ok\ncategory,count\ntags,12\nSemantic search: [^\n]+\nlog file: /);
    expect(r.structuredContent).toMatchObject({ ok: true, serverUrl: SERVER_URL, recentErrors: expect.any(Array) });
    expect(r.structuredContent).toHaveProperty("semantic.available");
    expect(r.structuredContent).toHaveProperty("logFile");
  });

  it("should_cap_the_category_listing_at_500_chars", async () => {
    const { d } = deps({ listLibraries: async () => "x".repeat(600) });
    const r = await pingTool().handler({}, d);
    expect(text(r).split("\n")[1]).toBe("x".repeat(500));
  });

  it("should_return_isError_with_the_cause_when_the_library_id_cannot_be_resolved", async () => {
    const { d, listCalls } = deps({
      resolveLibraryId: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:9");
      },
    });
    const r = await pingTool().handler({}, d);
    expect(r.isError).toBe(true);
    expect(listCalls).toEqual([]);
    expect(text(r)).toMatch(/^Calibre unreachable: connect ECONNREFUSED 127\.0\.0\.1:9\nSemantic search: /);
    expect(r.structuredContent).toMatchObject({
      ok: false,
      error: "connect ECONNREFUSED 127.0.0.1:9",
      serverUrl: SERVER_URL,
    });
    // the semantic diagnosis reads local state, so it is still reported when Calibre is down
    expect(r.structuredContent).toHaveProperty("semantic.available");
  });

  it("should_return_isError_when_calibredb_fails_and_list_the_failure_in_recentErrors", async () => {
    const { d } = deps({
      listLibraries: async () => {
        throw new Error("calibredb: Library Programming_Books not found");
      },
    });
    const r = await pingTool().handler({}, d);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Calibre unreachable: calibredb: Library Programming_Books not found");
    const sc = r.structuredContent as { recentErrors: Array<{ msg: string }> };
    expect(sc.recentErrors.at(-1)?.msg).toBe("ping failed");
  });
});

describe("calibre_ping busy libraries", () => {
  it("should_report_a_busy_library_in_text_and_structured_content", async () => {
    const busy = new LibraryBusyTracker();
    busy.markBusy("Programming_Books", "content-server");
    const { d } = deps({
      listLibraries: async () => Promise.reject(new CalibreBusyError("Programming_Books", 60_000)),
    });
    const r = await pingTool().handler({}, { ...d, libraryBusy: busy });
    expect(text(r)).toContain('busy: library "Programming_Books" — Calibre timed out (content-server)');
    expect(r.structuredContent?.busyLibraries).toEqual([
      expect.objectContaining({ libraryId: "Programming_Books", source: "content-server" }),
    ]);
  });

  it("should_say_nothing_about_busy_when_no_library_is_busy", async () => {
    const { d } = deps({});
    const r = await pingTool().handler({}, { ...d, libraryBusy: new LibraryBusyTracker() });
    expect(text(r)).not.toContain("busy:");
  });
});
