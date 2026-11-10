// #529 (follow-up to #494): a gateway 502/503/504 in calibredb's stderr is `calibre_busy`, like the
// same status on an HTTP read or a write through the presenter. 500 stays `calibre_error`.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { log } from "../../src/logging.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import { errorCodeFor } from "../../src/domain/error-codes.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { SearchDeps } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const cli = (stderr: string) => new CalibreCliError(1, "calibredb command failed", stderr);

describe("errorCodeFor — gateway 5xx in calibredb stderr (#529)", () => {
  it.each([
    ["HTTP Error 502: Bad Gateway", "calibre_busy"],
    ["HTTP Error 503: Service Unavailable", "calibre_busy"],
    ["HTTP Error 504: Gateway Timeout", "calibre_busy"],
    ["HTTP Error 500: Internal Server Error", "calibre_error"],
  ] as const)("should_map_%s_to_%s", (stderr, code) => {
    expect(errorCodeFor(cli(stderr))).toBe(code);
  });

  // nothing answered when the connection is refused, so unreachable wins over a stray 503 line
  it("should_keep_calibre_unreachable_when_a_connection_refusal_and_a_503_share_a_stderr", () => {
    expect(
      errorCodeFor(cli("ConnectionRefusedError: [Errno 61] Connection refused\nHTTP Error 503: Service Unavailable")),
    ).toBe("calibre_unreachable");
  });
});

describe("a calibredb-routed read that hits a gateway 503 (#529)", () => {
  it("should_return_calibre_busy_with_its_next_step_for_an_annotations_search", async () => {
    invalidateBundleCache();
    const d = {
      config: loadConfig({}),
      content: {
        resolveLibraryId: async () => "Programming_Books",
        virtualLibraries: async () => ({}),
        search: async () => ({ total: 0, bookIds: [], libraryId: "Programming_Books" }),
      } as unknown as ToolDeps["content"],
      calibre: {
        calibreVersion: async () => parseCalibreVersion("calibredb (calibre 9.18)"),
        calibredb: async (args: readonly string[]) => {
          if (args[0] === "saved_searches") return { stdout: "Integration status: False\n", stderr: "" };
          throw cli("HTTP Error 503: Service Unavailable");
        },
      } as unknown as ToolDeps["calibre"],
      extractor: {} as ToolDeps["extractor"],
      figures: {} as ToolDeps["figures"],
      embedder: {} as ToolDeps["embedder"],
      log,
    } as unknown as SearchDeps;
    const r = await searchTool.handler(
      { scope: "library", limit: 20, query: "tcp", mode: "annotations" } as never,
      d as never,
    );
    expect(r.structuredContent).toMatchObject({ errorCode: "calibre_busy" });
    expect((r.content[0] as { text: string }).text).toMatch(
      /\nCode: calibre_busy\nNext: retry in a few seconds — calibre_ping shows when the library is free$/,
    );
  });
});
