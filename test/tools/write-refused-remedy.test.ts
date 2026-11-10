// #437 follow-up: one remedy for Calibre refusing writes, defined once and naming both ways
// (the GUI setting for a GUI-run Content Server; --enable-local-write or an authenticated user for
// a command-line calibre-server), used by the write_refused hint, the refusal message and ping.

import { describe, expect, it } from "vitest";
import { defaultHint } from "../../src/domain/error-codes.js";
import { WRITE_REFUSED_MESSAGE } from "../../src/app/write-policy.js";
import { toolError } from "../../src/tools/result.js";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { textOf } from "./text-of.js";

const remedy = defaultHint("write_refused") ?? "";

describe("write-refused remedy (#437 follow-up)", () => {
  it("names the GUI setting, --enable-local-write and an authenticated user", () => {
    expect([
      remedy.includes(
        '"Allow un-authenticated local connections to make changes" (Preferences → Sharing over the net)',
      ),
      remedy.includes("--enable-local-write"),
      remedy.includes("authenticated"),
    ]).toEqual([true, true, true]);
  });

  it("is the step the refusal message states, so its error text says it once", () => {
    const t = textOf(toolError("write_refused", WRITE_REFUSED_MESSAGE));
    expect({
      inMessage: WRITE_REFUSED_MESSAGE.includes(remedy),
      code: t.split("\n").at(-1),
      next: t.split("\n").filter((l) => l.startsWith("Next: ")).length,
      steps: t.split("--enable-local-write").length - 1,
    }).toEqual({ inMessage: true, code: "Code: write_refused", next: 0, steps: 1 });
  });

  it("is what calibre_ping's refused line says", async () => {
    const ping = allTools.find((t) => t.name === "calibre_ping")!;
    const d: ToolDeps = {
      config: loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" }),
      content: {
        resolveLibraryId: async () => "My_Books",
        libraryInfo: async () => ({ libraryMap: { My_Books: "My Books" }, defaultLibrary: "My_Books" }),
        probeWriteAccess: async () => ({ access: "refused" as const }),
      } as unknown as ToolDeps["content"],
      calibre: { listLibraries: async () => "category,count" } as unknown as ToolDeps["calibre"],
      extractor: {} as ToolDeps["extractor"],
      figures: {} as ToolDeps["figures"],
      embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
      index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
      log,
    };
    const line = textOf(await ping.handler({}, d))
      .split("\n")
      .find((l) => l.startsWith("calibre writes: "));
    expect(line).toBe(`calibre writes: refused — ${remedy}`);
  });
});
