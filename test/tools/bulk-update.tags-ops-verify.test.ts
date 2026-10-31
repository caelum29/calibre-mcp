// PR #333 review (#321): a timed-out tags merge must be verified against the MERGED list (the
// re-read rule "moved away from before" can't tell it from the raw params, so spy on the args),
// and the tag-spelling lookup must escape quotes and backslashes in Calibre's search syntax.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../../src/app/write-policy.js", async (orig) => {
  const real = await orig<typeof import("../../src/app/write-policy.js")>();
  return { ...real, verifyTimedOutWrite: vi.fn(real.verifyTimedOutWrite) };
});
import { verifyTimedOutWrite } from "../../src/app/write-policy.js";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { book, fakeBulkDeps } from "./fake-bulk-tags.js";

const run = (args: Record<string, unknown>, d: ToolDeps) =>
  bulkUpdateTool.handler(z.object(bulkUpdateTool.inputSchema).parse(args), d);

describe("tags ops — write-verify gets the merged list (PR #333 review)", () => {
  it("should_verify_a_timed_out_write_against_the_merged_tags", async () => {
    const f = fakeBulkDeps({
      selected: [book({ id: 1, tags: ["old", "x"] })],
      calibredb: async () => {
        throw new CalibreCliTimeoutError("calibredb command timed out");
      },
    });
    await run({ ids: [1], changes: { publisher: "P" }, tags_add: ["DDD"], tags_remove: ["x"], preview: false }, f.deps);
    expect(vi.mocked(verifyTimedOutWrite).mock.calls.map(([, w]) => w.changes)).toEqual([
      { publisher: "P", tags: ["old", "DDD"] },
    ]);
  });
});

describe("tags ops — lookup query escaping (PR #333 review)", () => {
  it("should_escape_quotes_and_backslashes_in_the_tag_search", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["old"] })] });
    await run({ ids: [1], tags_add: ['He said "hi"', "C:\\temp"] }, f.deps);
    expect(f.searches.filter((q) => q.startsWith("tags:"))).toEqual(['tags:"=He said \\"hi\\""', 'tags:"=C:\\\\temp"']);
  });
});
