// #439: calibre_ping reports whether Calibre itself accepts writes, not just our own gate,
// in both channels, and flags our gate ON + Calibre refusing as a mismatch. Fakes only.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const REFUSED_LINE =
  'calibre writes: refused — enable "Allow un-authenticated local connections to make changes" ' +
  "(Preferences → Sharing over the net), or for a command-line calibre-server restart it with " +
  "--enable-local-write, or configure an authenticated non-restricted user";
const MISMATCH_LINE =
  "warning: CALIBRE_MCP_ENABLE_WRITE is on, but Calibre refuses writes — every write tool will fail until that setting is enabled";

type Probe = { access: "allowed" | "refused" } | { access: "unknown"; reason: string };

function deps(o: { probe?: Probe; writeEnabled?: boolean; unreachable?: boolean }) {
  const probeWriteAccess = vi.fn(async () => o.probe ?? { access: "allowed" });
  const d: ToolDeps = {
    config: loadConfig({
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
      ...(o.writeEnabled ? { CALIBRE_MCP_ENABLE_WRITE: "1" } : {}),
    }),
    content: {
      resolveLibraryId: async () => {
        if (o.unreachable) throw new Error("connect ECONNREFUSED 127.0.0.1:9");
        return "My_Books";
      },
      libraryInfo: async () => ({ libraryMap: { My_Books: "My Books" }, defaultLibrary: "My_Books" }),
      search: async () => ({ bookIds: [], total: 0, num: 0, offset: 0, sort: "title", libraryId: "My_Books" }),
      probeWriteAccess,
    } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "category,count" } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } satisfies Partial<ToolDeps["embedder"]> as ToolDeps["embedder"],
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
  return { d, probeWriteAccess };
}

const ping = () => allTools.find((t) => t.name === "calibre_ping")!;
const lines = (r: ToolResult): string[] =>
  r.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .split("\n");

/** The report's line right after the write-gate line, plus the outcome facts. */
async function report(o: Parameters<typeof deps>[0]) {
  const { d, probeWriteAccess } = deps(o);
  const r = await ping().handler({}, d);
  const ls = lines(r);
  const gate = ls.findIndex((l) => l.startsWith("writes: "));
  return {
    isError: r.isError,
    ok: r.structuredContent?.ok,
    calibreWriteAccess: r.structuredContent?.calibreWriteAccess,
    after: ls.slice(gate + 1, gate + 3),
    probed: probeWriteAccess.mock.calls,
    warned: ls.some((l) => l.startsWith("warning: ")),
  };
}

describe("calibre_ping Calibre write access (#439)", () => {
  it("should_report_allowed_in_both_channels", async () => {
    const r = await report({ probe: { access: "allowed" } });
    expect({ ...r, after: r.after[0] }).toEqual({
      isError: undefined,
      ok: true,
      calibreWriteAccess: "allowed",
      after: "calibre writes: allowed",
      probed: [["My_Books", { timeoutMs: 5000 }]],
      warned: false,
    });
  });

  it("should_report_refused_with_the_setting_to_enable_and_keep_ok_true", async () => {
    const r = await report({ probe: { access: "refused" } });
    expect([r.ok, r.calibreWriteAccess, r.after[0], r.warned]).toEqual([true, "refused", REFUSED_LINE, false]);
  });

  it("should_report_unknown_with_its_reason_and_claim_nothing", async () => {
    const r = await report({ probe: { access: "unknown", reason: "HTTP 500" } });
    expect([r.ok, r.calibreWriteAccess, r.after[0], r.warned]).toEqual([
      true,
      "unknown",
      "calibre writes: unknown (HTTP 500)",
      false,
    ]);
  });

  it("should_warn_when_our_gate_is_on_but_calibre_refuses", async () => {
    const r = await report({ probe: { access: "refused" }, writeEnabled: true });
    expect([r.ok, r.after]).toEqual([true, [REFUSED_LINE, MISMATCH_LINE]]);
  });

  it("should_not_warn_when_our_gate_is_on_and_calibre_allows", async () => {
    const r = await report({ probe: { access: "allowed" }, writeEnabled: true });
    expect(r.warned).toBe(false);
  });

  it("should_not_probe_when_calibre_is_unreachable", async () => {
    const r = await report({ unreachable: true });
    expect([r.isError, r.probed, r.calibreWriteAccess, r.after[0]?.startsWith("calibre writes")]).toEqual([
      true,
      [],
      undefined,
      false,
    ]);
  });
});

// #475 review: a probe that never answers must not hold up ping — the adapter's own budget turns
// it into `unknown (timed out)` and the rest of the report is normal.
describe("calibre_ping with a hanging write probe (#439 review)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("should_report_unknown_timed_out_and_stay_ok", async () => {
    vi.useFakeTimers();
    // the POST never answers until its abort signal fires
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) =>
            init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))),
          ),
      ),
    );
    const server = new ContentServerClient(loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9" }));
    const { d } = deps({});
    d.content.probeWriteAccess = (libId, opts) => server.probeWriteAccess(libId, opts);
    const pending = ping().handler({}, d);
    await vi.advanceTimersByTimeAsync(5000);
    const r = await pending;
    expect([r.isError, r.structuredContent?.ok, r.structuredContent?.calibreWriteAccess]).toEqual([
      undefined,
      true,
      "unknown",
    ]);
    expect(lines(r)).toContain("calibre writes: unknown (timed out)");
  });
});
