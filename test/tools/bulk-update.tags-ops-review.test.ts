// PR #333 review (#321): tag-ops calls skip books the merge leaves unchanged, never look up a
// tag they also remove, refuse commas inside a tag, treat null as absent, return an actionable
// error when the spelling lookup fails, and put the add/remove counts in structuredContent.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { CalibreHttpTimeoutError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { book, fakeBulkDeps, textOf } from "./fake-bulk-tags.js";

const schema = z.object(bulkUpdateTool.inputSchema);
const run = (args: Record<string, unknown>, d: ToolDeps) => bulkUpdateTool.handler(schema.parse(args), d);

describe("tags ops — no-op books are skipped (PR #333 review)", () => {
  it("should_write_only_books_the_merge_changes", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["old"] }), book({ id: 2, tags: ["x", "old"] })] });
    const r = await run({ ids: [1, 2], tags_remove: ["x"], preview: false }, f.deps);
    expect(f.cli.mock.calls.map(([a]) => a)).toEqual([["set_metadata", "2", "--field", "tags:old"]]);
    expect(r.structuredContent?.applied).toEqual([2]);
    expect(r.structuredContent?.unchanged).toEqual([1]);
    expect(textOf(r)).toBe("Applied tags to 1/1 book(s). 1 already up to date (skipped): 1.");
  });

  it("should_still_write_a_book_whose_other_changes_differ", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["old"] })] });
    await run({ ids: [1], changes: { publisher: "P" }, tags_add: ["old"], preview: false }, f.deps);
    expect(f.cli).toHaveBeenCalledTimes(1);
  });

  it("should_not_skip_on_the_changes_only_path", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["old"] })] });
    const r = await run({ ids: [1], changes: { tags: ["old"] }, preview: false }, f.deps);
    expect(f.cli).toHaveBeenCalledTimes(1);
    expect(r.structuredContent?.unchanged).toBeUndefined();
  });
});

describe("tags ops — input (PR #333 review)", () => {
  it("should_not_look_up_a_tag_that_is_also_removed", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["old"] })] });
    await run({ ids: [1], tags_add: ["python", "go"], tags_remove: ["Python"] }, f.deps);
    expect(f.searches.filter((q) => q.startsWith("tags:"))).toEqual(['tags:"=go"']);
  });

  it("should_reject_a_comma_inside_a_tag", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1 })] });
    for (const args of [{ tags_add: ["a,b"] }, { tags_remove: ["ok", "x, y"] }]) {
      const r = await run({ ids: [1], ...args }, f.deps);
      expect(r.isError).toBe(true);
      expect(r.structuredContent?.errorCode).toBe("invalid_input");
      expect(textOf(r)).toContain("contains a comma; Calibre splits tags on commas. Pass each tag as its own entry.");
    }
    expect(f.cli).not.toHaveBeenCalled();
  });

  it("should_treat_null_as_absent_and_stringify_numbers", () => {
    expect(schema.parse({ ids: [1], tags_add: null, tags_remove: null })).toMatchObject({
      tags_add: undefined,
      tags_remove: undefined,
    });
    expect(schema.parse({ ids: [1], tags_add: [2024, "x"] }).tags_add).toEqual(["2024", "x"]);
    expect(schema.parse({ ids: [1], tags_add: 7 }).tags_add).toEqual(["7"]);
  });
});

describe("tags ops — spelling lookup failure (PR #333 review)", () => {
  it("should_return_an_actionable_error_and_write_nothing", async () => {
    const f = fakeBulkDeps({
      selected: [book({ id: 1 })],
      tagSearch: async () => {
        throw new CalibreHttpTimeoutError("http://localhost:8080/ajax/search");
      },
    });
    const r = await run({ ids: [1], tags_add: ["new"], preview: false }, f.deps);
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe("timeout");
    expect(textOf(r)).toBe(
      "Error: Couldn't check the library's existing tag spellings (Content Server request timed out). Nothing was written; retry the call.",
    );
    expect(f.cli).not.toHaveBeenCalled();
  });
});

describe("tags ops — counts in structuredContent (PR #333 review)", () => {
  it("should_report_added_and_removed_per_book_in_the_preview", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["old", "x"] }), book({ id: 2, tags: ["new"] })] });
    const r = await run({ ids: [1, 2], tags_add: ["new"], tags_remove: ["x"] }, f.deps);
    const books = r.structuredContent?.books as { id: number; tagsAdded?: number; tagsRemoved?: number }[];
    expect(books.map(({ id, tagsAdded, tagsRemoved }) => ({ id, tagsAdded, tagsRemoved }))).toEqual([
      { id: 1, tagsAdded: 1, tagsRemoved: 1 },
      { id: 2, tagsAdded: 0, tagsRemoved: 0 },
    ]);
    expect(
      z.object(bulkUpdateTool.outputSchema!).safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success,
    ).toBe(true);
  });
});
