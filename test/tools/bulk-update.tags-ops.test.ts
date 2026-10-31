// #321: calibre_bulk_update tags_add / tags_remove merge tags per book instead of replacing
// the list: new = (existing ∪ tags_add) \ tags_remove, case-insensitively like Calibre. An
// added tag takes the library's existing spelling, since a different-case set would rename
// that tag on every book (Calibre keeps one case-insensitive item; see #332).
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 1,
  uuid: "u",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: ["en"],
  ...over,
});

type Cli = (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

interface Fake {
  selected: Book[];
  /** Books elsewhere in the library, found by the tag-spelling lookup. */
  others?: Book[];
  calibredb?: Cli;
  reread?: (id: number) => Promise<Book>;
}

/** Fake deps; `searches` records every search query the handler sent. */
function deps(f: Fake): { deps: ToolDeps; searches: string[]; cli: ReturnType<typeof vi.fn<Cli>> } {
  const all = [...f.selected, ...(f.others ?? [])];
  const byId = new Map(all.map((b) => [b.id, b] as const));
  const searches: string[] = [];
  const cli = vi.fn<Cli>(f.calibredb ?? (async () => ({ stdout: "", stderr: "" })));
  const page = (ids: number[]) => ({
    bookIds: ids,
    total: ids.length,
    num: ids.length,
    offset: 0,
    sort: "title",
    libraryId: "Lib",
  });
  const content = {
    resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books",
    getBook: f.reread ?? (async (id: number): Promise<Book> => byId.get(id) ?? book({ id })),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
    search: async ({ query }: { query: string }) => {
      searches.push(query);
      const m = /^tags:"=(.*)"$/.exec(query);
      if (!m) return page(f.selected.map((b) => b.id));
      const want = m[1]!.toLowerCase();
      return page(all.filter((b) => b.tags.some((t) => t.toLowerCase() === want)).map((b) => b.id));
    },
  };
  return {
    searches,
    cli,
    deps: {
      config: loadConfig({}),
      content: content as unknown as ToolDeps["content"],
      calibre: { calibredb: cli } as unknown as ToolDeps["calibre"],
      extractor: {} as ToolDeps["extractor"],
      figures: {} as ToolDeps["figures"],
      embedder: {} as ToolDeps["embedder"],
      index: {} as ToolDeps["index"],
      log,
    },
  };
}

const text = (r: { content: { type: string; text?: string }[] }): string =>
  r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

const run = (args: Record<string, unknown>, d: ToolDeps) =>
  bulkUpdateTool.handler(z.object(bulkUpdateTool.inputSchema).parse(args), d);

describe("calibre_bulk_update tags_add / tags_remove — merge (#321)", () => {
  it("should_append_an_added_tag_and_keep_the_existing_ones", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old", "x"] })] });
    const r = await run({ ids: [1], tags_add: ["DDD"], preview: false }, f.deps);
    expect(r.isError).toBeFalsy();
    expect(f.cli.mock.calls.map(([a]) => a)).toEqual([["set_metadata", "1", "--field", "tags:old,x,DDD"]]);
    expect(text(r)).toBe("Applied tags to 1/1 book(s).");
  });

  it("should_merge_per_book", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["a"] }), book({ id: 2, tags: ["b", "DDD"] })] });
    await run({ ids: [1, 2], tags_add: ["DDD"], preview: false }, f.deps);
    expect(f.cli.mock.calls.map(([a]) => a[3])).toEqual(["tags:a,DDD", "tags:b,DDD"]);
  });

  it("should_treat_removing_a_missing_tag_as_a_no_op", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old"] })] });
    const r = await run({ ids: [1], tags_remove: ["nope"] }, f.deps);
    expect(text(r)).toContain('  tags: ["old"] → ["old"] (no change)');
    expect(text(r)).toContain("1 book(s) selected, 0 would change");
  });

  it("should_not_duplicate_an_existing_tag", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old"] })] });
    const r = await run({ ids: [1], tags_add: ["old"] }, f.deps);
    expect(text(r)).toContain('  tags: ["old"] → ["old"] (no change)');
  });

  it("should_add_and_remove_in_one_call", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old", "x"] })] });
    const r = await run({ ids: [1], tags_add: ["new"], tags_remove: ["x"] }, f.deps);
    expect(text(r)).toContain('  tags: ["old","x"] → ["old","new"] (+1 added, 1 removed)');
  });

  it("should_let_remove_win_over_add_for_the_same_tag", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old"] })] });
    const r = await run({ ids: [1], tags_add: ["X"], tags_remove: ["x"] }, f.deps);
    expect(text(r)).toContain('  tags: ["old"] → ["old"] (no change)');
  });

  it("should_combine_with_other_changes", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old"] })] });
    await run({ ids: [1], changes: { publisher: "P" }, tags_add: ["new"], preview: false }, f.deps);
    expect(f.cli.mock.calls.map(([a]) => a)).toEqual([
      ["set_metadata", "1", "--field", "publisher:P", "--field", "tags:old,new"],
    ]);
  });
});

describe("calibre_bulk_update tags_add / tags_remove — input (#321)", () => {
  it("should_reject_tags_ops_together_with_changes_tags", async () => {
    const f = deps({ selected: [book({ id: 1 })] });
    const r = await run({ ids: [1], changes: { tags: ["a"] }, tags_add: ["b"] }, f.deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(
      "Pass tags either as changes.tags (replaces the whole list) or as tags_add/tags_remove (merges per book), not both.",
    );
  });

  it("should_require_changes_or_a_tags_op", async () => {
    const f = deps({ selected: [book({ id: 1 })] });
    const r = await run({ ids: [1] }, f.deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Provide at least one field in changes, or tags_add/tags_remove.");
  });

  it("should_coerce_a_comma_string_and_a_json_string", () => {
    const schema = z.object(bulkUpdateTool.inputSchema);
    expect(schema.parse({ ids: [1], tags_add: "a, b ,,c" }).tags_add).toEqual(["a", "b", "c"]);
    expect(schema.parse({ ids: [1], tags_remove: '["x","y"]' }).tags_remove).toEqual(["x", "y"]);
  });
});

describe("calibre_bulk_update tags_add / tags_remove — preview (#321)", () => {
  it("should_show_the_merge_in_the_text_channel_without_a_replacement_flag", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old", "x", "y"] })] });
    const r = await run({ ids: [1], tags_remove: ["x", "y"] }, f.deps);
    expect(r.content).toHaveLength(1);
    expect(text(r)).toContain('#1 T\n  tags: ["old","x","y"] → ["old"] (+0 added, 2 removed)');
    expect(text(r)).not.toContain("replaces all existing");
    expect(f.cli).not.toHaveBeenCalled();
  });
});

describe("calibre_bulk_update tags_add / tags_remove — case (#321)", () => {
  it("should_remove_Python_for_tags_remove_python", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["Python", "Rust"] })] });
    const r = await run({ ids: [1], tags_remove: ["python"] }, f.deps);
    expect(text(r)).toContain('  tags: ["Python","Rust"] → ["Rust"] (+0 added, 1 removed)');
  });

  it("should_keep_Python_for_tags_add_python_without_a_rename_note", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["Python"] })] });
    const r = await run({ ids: [1], tags_add: ["python"] }, f.deps);
    expect(text(r)).toContain('  tags: ["Python"] → ["Python"] (no change)');
    expect(text(r)).not.toContain("renames it");
  });

  it("should_use_the_library_spelling_of_an_added_tag", async () => {
    const f = deps({
      selected: [book({ id: 1, tags: ["old"] })],
      others: [book({ id: 9, tags: ["Python", "x"] })],
    });
    const preview = await run({ ids: [1], tags_add: ["python"] }, f.deps);
    expect(text(preview)).toContain('  tags: ["old"] → ["old","Python"] (+1 added, 0 removed)');
    expect(text(preview)).not.toContain("renames it");
    expect(f.searches).toContain('tags:"=python"');
    await run({ ids: [1], tags_add: ["python"], preview: false }, f.deps);
    expect(f.cli.mock.calls.map(([a]) => a[3])).toEqual(["tags:old,Python"]);
  });

  it("should_keep_a_new_tag_as_given_when_the_library_has_none", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old"] })] });
    const r = await run({ ids: [1], tags_add: ["Brand New"] }, f.deps);
    expect(text(r)).toContain('  tags: ["old"] → ["old","Brand New"] (+1 added, 0 removed)');
  });

  it("should_take_the_spelling_from_another_selected_book_without_a_lookup", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old"] }), book({ id: 2, tags: ["DDD"] })] });
    const r = await run({ ids: [1, 2], tags_add: ["ddd"] }, f.deps);
    expect(text(r)).toContain('  tags: ["old"] → ["old","DDD"] (+1 added, 0 removed)');
    expect(f.searches.filter((q) => q.startsWith("tags:"))).toEqual([]);
  });
});

describe("calibre_bulk_update tags_add / tags_remove — timed-out write (#321)", () => {
  const timeout: Cli = async () => {
    throw new CalibreCliTimeoutError("calibredb command timed out");
  };

  it("should_count_a_timeout_as_applied_when_the_reread_holds_the_merged_list", async () => {
    const f = deps({
      selected: [book({ id: 1, tags: ["old"] })],
      calibredb: timeout,
      reread: async () => book({ id: 1, tags: ["old", "DDD"] }),
    });
    const r = await run({ ids: [1], tags_add: ["DDD"], preview: false }, f.deps);
    expect(r.structuredContent?.applied).toEqual([1]);
    expect(r.structuredContent?.failed).toEqual([]);
  });

  it("should_fail_a_timeout_when_the_reread_is_unchanged", async () => {
    const f = deps({ selected: [book({ id: 1, tags: ["old"] })], calibredb: timeout });
    const r = await run({ ids: [1], tags_add: ["DDD"], preview: false }, f.deps);
    expect(r.structuredContent?.applied).toEqual([]);
    expect((r.structuredContent?.failed as { id: number }[] | undefined)?.map((x) => x.id)).toEqual([1]);
  });
});
