// PR #380 review round 1 (#370 §Write path): a no-op tags merge is re-checked against a fresh
// read before it is skipped (the GUI may have changed the tags since selection), and the
// intended-value check trims whitespace and splits an "A & B" author entry like calibredb does.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { changesSatisfied } from "../../src/domain/book-fields.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { book, fakeBulkDeps } from "./fake-bulk-tags.js";

const schema = z.object(bulkUpdateTool.inputSchema);
const run = (args: Record<string, unknown>, d: BaseDeps) => bulkUpdateTool.handler(schema.parse(args), d);

describe("tags ops re-read before skipping a no-op book (PR #380 review)", () => {
  it("should_write_a_book_whose_tag_the_GUI_removed_after_selection", async () => {
    // selection saw DDD; the GUI has since removed it, so tags_add DDD is not a no-op any more
    const f = fakeBulkDeps({
      selected: [book({ id: 1, tags: ["a", "DDD"] })],
      reread: async () => book({ id: 1, tags: ["a"] }),
    });
    const r = await run({ ids: [1], tags_add: ["DDD"], preview: false }, f.deps);
    expect([f.cli.mock.calls.map(([a]) => a[3]), r.structuredContent?.applied, r.structuredContent?.unchanged]).toEqual(
      [["tags:a,DDD"], [1], []],
    );
  });

  it("should_make_no_write_call_for_a_true_no_op", async () => {
    const f = fakeBulkDeps({
      selected: [book({ id: 1, tags: ["a", "DDD"] })],
      reread: async () => book({ id: 1, tags: ["a", "DDD"] }),
    });
    const r = await run({ ids: [1], tags_add: ["DDD"], preview: false }, f.deps);
    expect([f.cli.mock.calls.length, r.structuredContent?.unchanged]).toEqual([0, [1]]);
  });
});

describe("matchesIntended trims and splits like calibredb (PR #380 review)", () => {
  it("should_count_a_tag_entry_with_surrounding_whitespace", () => {
    expect(changesSatisfied(book(), book({ tags: ["a"] }), { tags: ["a "] })).toBe(true);
  });

  it("should_count_a_publisher_with_surrounding_whitespace", () => {
    expect(changesSatisfied(book(), book({ publisher: "P" }), { publisher: "  P " })).toBe(true);
  });

  it("should_count_a_title_read_back_with_trailing_whitespace", () => {
    expect(changesSatisfied(book(), book({ title: "New " }), { title: "New" })).toBe(true);
  });

  it("should_split_an_A_and_B_author_entry", () => {
    expect(changesSatisfied(book(), book({ authors: ["A", "B"] }), { authors: ["A & B"] })).toBe(true);
  });

  it("should_still_reject_a_different_publisher_after_trimming", () => {
    expect(changesSatisfied(book(), book({ publisher: "Q" }), { publisher: " P " })).toBe(false);
  });
});
