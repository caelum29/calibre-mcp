// #370 §Write path box 4: the preview's ⚠ warnings (list replacement #306, case-only rename
// #325) also reach structuredContent, as books[].warnings, the same strings as the text lines,
// for clients that read only structuredContent (Claude Code).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { book, fakeBulkDeps } from "./fake-bulk-tags.js";
import { textOf } from "./text-of.js";

const schema = z.object(bulkUpdateTool.inputSchema);
const run = (args: Record<string, unknown>, d: BaseDeps) => bulkUpdateTool.handler(schema.parse(args), d);
const warningsOf = (r: { structuredContent?: Record<string, unknown> }) =>
  ((r.structuredContent?.books ?? []) as { id: number; warnings?: string[] }[]).map((b) => b.warnings);

const REPLACES = "tags: 3 → 1 (replaces all existing tags)";
const RENAME =
  "tags: Python → python renames it on every book in the library (Calibre keeps one case-insensitive item)";

describe("preview warnings in structuredContent (#370)", () => {
  it("should_carry_a_list_replacement_warning_per_book", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["x", "y", "z"] })] });
    const r = await run({ ids: [1], changes: { tags: ["zz"] } }, f.deps);
    expect(warningsOf(r)).toEqual([[REPLACES]]);
  });

  it("should_carry_a_case_rename_warning_per_book", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["Python", "Rust"] })] });
    const r = await run({ ids: [1], changes: { tags: ["python", "Rust"] } }, f.deps);
    expect(warningsOf(r)).toEqual([[RENAME]]);
  });

  it("should_omit_warnings_for_a_book_without_any", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["x", "y", "z"] }), book({ id: 2, tags: [] })] });
    const r = await run({ ids: [1, 2], changes: { tags: ["zz"] } }, f.deps);
    expect(warningsOf(r)).toEqual([[REPLACES], undefined]);
  });

  it("should_match_the_text_warning_lines_exactly", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["x", "y", "z"] })] });
    const r = await run({ ids: [1], changes: { tags: ["zz"] } }, f.deps);
    const lines = textOf(r)
      .split("\n")
      .filter((l) => l.startsWith("  ⚠ "))
      .map((l) => l.slice(4));
    expect(lines).toEqual(warningsOf(r)[0]);
  });

  it("should_stay_outputSchema_valid_with_warnings", async () => {
    const f = fakeBulkDeps({ selected: [book({ id: 1, tags: ["x", "y", "z"] })] });
    const r = await run({ ids: [1], changes: { tags: ["zz"] } }, f.deps);
    const out = z.object(bulkUpdateTool.outputSchema!);
    const parsed = out.safeParse(JSON.parse(JSON.stringify(r.structuredContent)));
    expect(parsed.success && (parsed.data.books as { warnings?: string[] }[])[0]?.warnings).toEqual([REPLACES]);
  });
});
