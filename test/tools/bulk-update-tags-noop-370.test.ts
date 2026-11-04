// #370 §Write path box 3: a tags_add / tags_remove call skips set_metadata for a book whose
// merge changes nothing (#333). Such books are not "applied" (nothing was written); they are
// listed as unchanged in both channels. The changes-only path still writes every book.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { book, fakeBulkDeps, textOf } from "./fake-bulk-tags.js";

const schema = z.object(bulkUpdateTool.inputSchema);
const run = (args: Record<string, unknown>, d: BaseDeps) => bulkUpdateTool.handler(schema.parse(args), d);
const FORBIDDEN = "HTTP Error 403: Forbidden";

describe("tags ops skip a no-op set_metadata (#370 / #333)", () => {
  it("should_write_only_the_book_whose_tags_change", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["a"] }), book({ id: 2, tags: ["b", "DDD"] })] });
    await run({ ids: [1, 2], tags_add: ["DDD"], preview: false }, f.deps);
    expect(f.cli.mock.calls.map(([a]) => a[3])).toEqual(["tags:a,DDD"]);
  });

  it("should_list_the_skipped_book_as_unchanged_not_applied", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["a"] }), book({ id: 2, tags: ["b", "DDD"] })] });
    const r = await run({ ids: [1, 2], tags_add: ["DDD"], preview: false }, f.deps);
    expect([r.structuredContent?.applied, r.structuredContent?.unchanged, r.structuredContent?.failed]).toEqual([
      [1],
      [2],
      [],
    ]);
  });

  it("should_name_the_unchanged_book_in_the_text", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["a"] }), book({ id: 2, tags: ["b", "DDD"] })] });
    const r = await run({ ids: [1, 2], tags_add: ["DDD"], preview: false }, f.deps);
    expect(textOf(r)).toBe("Applied tags to 1/2 book(s). Already current (nothing written): 2.");
  });

  it("should_write_nothing_when_no_book_changes", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["old"] }), book({ id: 2, tags: ["x"] })] });
    const r = await run({ ids: [1, 2], tags_remove: ["nope"], preview: false }, f.deps);
    expect([f.cli.mock.calls.length, r.isError ?? false, r.structuredContent?.unchanged, textOf(r)]).toEqual([
      0,
      false,
      [1, 2],
      "Applied tags to 0/2 book(s). Already current (nothing written): 1, 2.",
    ]);
  });

  it("should_return_an_outputSchema_valid_result_with_unchanged_books", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["a"] }), book({ id: 2, tags: ["b", "DDD"] })] });
    const r = await run({ ids: [1, 2], tags_add: ["DDD"], preview: false }, f.deps);
    const out = z.object(bulkUpdateTool.outputSchema!).strict();
    expect(out.safeParse(JSON.parse(JSON.stringify(r.structuredContent))).success).toBe(true);
  });

  it("should_keep_unchanged_books_visible_when_a_later_book_is_refused", async () => {
    // book 1 written, book 2 already current (skipped), book 3 refused, book 4 not attempted
    let calls = 0;
    const f = fakeBulkDeps({
      selected: [
        book({ id: 1, tags: ["a"] }),
        book({ id: 2, tags: ["DDD"] }),
        book({ id: 3, tags: ["c"] }),
        book({ id: 4, tags: ["d"] }),
      ],
      calibredb: async () => {
        if (++calls === 2) throw new CalibreCliError(1, "boom", FORBIDDEN);
        return { stdout: "", stderr: "" };
      },
    });
    const r = await run({ ids: [1, 2, 3, 4], tags_add: ["DDD"], preview: false }, f.deps);
    expect([
      r.structuredContent?.applied,
      r.structuredContent?.unchanged,
      r.structuredContent?.retryIds,
      textOf(r).includes("Already current (nothing written): 2."),
    ]).toEqual([[1], [2], [3, 4], true]);
  });
});
