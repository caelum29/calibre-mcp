// Unknown bundle at handler level (#367): a filter naming no bundle fails by a CHECK, not a throw,
// so the resolver returns no `cause` and toolErrorFrom falls back to "not_found". A listing that
// THROWS keeps its own cause's code instead. Both must reach the model as the right errorCode.

import { beforeEach, describe, expect, it } from "vitest";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { loadConfig } from "../../src/config.js";
import { CalibreHttpTimeoutError } from "../../src/domain/errors.js";
import { log } from "../../src/logging.js";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { findDuplicatesTool } from "../../src/tools/calibre_find_duplicates.js";
import { qualityReportTool } from "../../src/tools/calibre_quality_report.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const SAVED_SEARCHES = `Integration status: False
Name: Rust
Search string: tags:"=Rust"
`;

/** Only what filter resolution touches: library id + the saved-search listing (which may throw). */
function deps(listing: () => Promise<{ stdout: string; stderr: string }>): ToolDeps {
  return {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Lib",
      virtualLibraries: async () => ({}),
    } as unknown as ToolDeps["content"],
    calibre: { calibredb: listing } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  } as unknown as ToolDeps;
}

const listsBundles = () => deps(async () => ({ stdout: SAVED_SEARCHES, stderr: "" }));
const listingTimesOut = () =>
  deps(async () => {
    throw new CalibreHttpTimeoutError("http://localhost:8080/cdb/cmd/saved_searches");
  });

type Call = (d: ToolDeps) => Promise<ToolResult>;
const CALLS: Array<[string, Call]> = [
  [
    "calibre_search",
    (d) => searchTool.handler({ query: "x", mode: "meta", scope: "library", limit: 20, filter: "Golang" }, d as never),
  ],
  ["calibre_quality_report", (d) => qualityReportTool.handler({ limit: 10, filter: "Golang" }, d as never)],
  [
    "calibre_find_duplicates",
    (d) => findDuplicatesTool.handler({ mode: "identical", filter: "Golang" } as never, d as never),
  ],
  [
    "calibre_bulk_update",
    (d) => bulkUpdateTool.handler({ changes: { publisher: "Acme" }, filter: "Golang", preview: true }, d as never),
  ],
];

beforeEach(() => invalidateBundleCache());

describe.each(CALLS)("%s with an unknown bundle (#367)", (_name, call) => {
  it("should_fail_as_not_found_naming_the_available_bundles", async () => {
    const r = await call(listsBundles());
    expect({ isError: r.isError, code: r.structuredContent?.errorCode }).toEqual({ isError: true, code: "not_found" });
    expect(r.structuredContent?.error).toContain('Unknown bundle "Golang". Available bundles: Rust.');
  });

  it("should_keep_the_listing_failures_own_code_when_the_listing_throws", async () => {
    const r = await call(listingTimesOut());
    expect({ isError: r.isError, code: r.structuredContent?.errorCode }).toEqual({ isError: true, code: "timeout" });
  });
});
