// calibre_search mode=annotations / mode=notes (#500, D-029): Calibre 9.18+ highlights, bookmarks
// and item notes, read through calibredb. Fixtures are real captures (docs/dev/local-groundtruth.md).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { log } from "../../src/logging.js";
import { parseCalibreVersion, type CalibreVersionInfo } from "../../src/domain/calibre-version.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { SearchDeps } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const FIX = path.join(import.meta.dirname, "../calibre/fixtures/annotations-notes-500");
const raw = (name: string) => readFileSync(path.join(FIX, `${name}.raw`), "utf8");

const SAVED_SEARCHES = `Integration status: False
Name: Rust
Search string: tags:"=Rust"

Name: -hidden
Search string: tags:"=Hidden"
`;

interface Call {
  args: string[];
  library: string;
}

function deps(
  stdoutFor: (args: string[]) => string,
  version: CalibreVersionInfo = parseCalibreVersion("calibredb (calibre 9.18)"),
) {
  invalidateBundleCache();
  const calls: Call[] = [];
  const d = {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      virtualLibraries: async () => ({}),
      search: async () => ({ total: 7, bookIds: [], libraryId: "Programming_Books" }),
    } as unknown as ToolDeps["content"],
    calibre: {
      calibreVersion: async () => version,
      calibredb: async (args: readonly string[], opts: { library: string }) => {
        calls.push({ args: [...args], library: opts.library });
        if (args[0] === "saved_searches") return { stdout: SAVED_SEARCHES, stderr: "" };
        return { stdout: stdoutFor([...args]), stderr: "" };
      },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  } as unknown as SearchDeps;
  // the calibredb calls of the search itself, without the bundle listing
  const searchCalls = () => calls.filter((c) => c.args[0] !== "saved_searches");
  return { d, calls, searchCalls };
}

const textOf = (r: ToolResult) => r.content.map((b) => ("text" in b ? b.text : "")).join("\n");
const sc = (r: ToolResult) => r.structuredContent as Record<string, unknown>;
const run = (args: Record<string, unknown>, d: SearchDeps) =>
  searchTool.handler({ scope: "library", limit: 20, ...args } as never, d as never);

describe("calibre_search mode=annotations (#500)", () => {
  it("should_run_calibredb_annotations_search_as_json_on_the_resolved_library_id", async () => {
    const f = deps(() => raw("annotations-search-commit"));
    await run({ query: "commit", mode: "annotations", include_excluded: true }, f.d);
    expect(f.searchCalls()).toEqual([
      { args: ["annotations", "search", "commit", "--format", "json"], library: "Programming_Books" },
    ]);
  });

  it("should_keep_calibres_relevance_order", async () => {
    const r = await run({ query: "commit", mode: "annotations" }, deps(() => raw("annotations-search-commit")).d);
    expect((sc(r).annotations as Array<{ id: number }>).map((a) => a.id)).toEqual([23, 16]);
  });

  it("should_map_a_highlight_with_its_note_chapter_and_book", async () => {
    const r = await run({ query: "commit", mode: "annotations" }, deps(() => raw("annotations-search-commit")).d);
    expect((sc(r).annotations as unknown[])[0]).toEqual({
      id: 23,
      bookId: 644,
      title: "Building Event-Driven Microservices (for True Epub)",
      format: "EPUB",
      type: "highlight",
      text: "commit",
      note: "Commit offsets only after processing, or you lose events on crash.",
      chapter: "6. Integrating Event-Driven Architectures with Existing Systems › The Dual Write Antipattern",
      timestamp: "2026-11-10T18:13:47.914Z",
      user: "local:viewer",
    });
  });

  it("should_show_every_hit_in_the_text_channel_in_order", async () => {
    const t = textOf(
      await run({ query: "commit", mode: "annotations" }, deps(() => raw("annotations-search-commit")).d),
    );
    expect(t).toContain('Found 2 annotations matching "commit"');
    expect(t.indexOf("annotation 23 ·")).toBeGreaterThan(-1);
    expect(t.indexOf("annotation 16 ·")).toBeGreaterThan(t.indexOf("annotation 23 ·"));
    expect(t).toContain("Commit offsets only after processing, or you lose events on crash.");
    expect(t).toContain("git rebase -i");
  });

  it("should_map_a_bookmark_with_its_title_as_text", async () => {
    const r = await run({ query: "outbox", mode: "annotations" }, deps(() => raw("annotations-search-bookmark")).d);
    expect(sc(r).annotations).toEqual([
      {
        id: 17,
        bookId: 644,
        title: "Building Event-Driven Microservices (for True Epub)",
        format: "EPUB",
        type: "bookmark",
        text: "Outbox pattern",
        timestamp: "2026-11-10T18:15:51.026924+00:00",
        user: "local:viewer",
      },
    ]);
  });

  it("should_report_zero_hits_without_an_error", async () => {
    const r = await run({ query: "zzzz", mode: "annotations" }, deps(() => raw("annotations-search-nomatch")).d);
    expect({ isError: r.isError === true, total: sc(r).total, annotations: sc(r).annotations }).toEqual({
      isError: false,
      total: 0,
      annotations: [],
    });
    expect(textOf(r)).toContain('0 annotations matched "zzzz"');
  });

  it("should_cap_the_hits_at_limit_and_keep_the_total", async () => {
    const r = await run(
      { query: "commit", mode: "annotations", limit: 1 },
      deps(() => raw("annotations-search-commit")).d,
    );
    expect({ total: sc(r).total, ids: (sc(r).annotations as Array<{ id: number }>).map((a) => a.id) }).toEqual({
      total: 2,
      ids: [23],
    });
  });

  it("should_answer_countOnly_with_the_count", async () => {
    const r = await run(
      { query: "commit", mode: "annotations", countOnly: true },
      deps(() => raw("annotations-search-commit")).d,
    );
    expect({ text: textOf(r), total: sc(r).total }).toEqual({ text: '2 annotations match "commit".', total: 2 });
  });

  it("should_restrict_to_the_bundle_and_subtract_markers_via_search", async () => {
    const f = deps(() => raw("annotations-search-scoped"));
    const r = await run({ query: "commit", mode: "annotations", filter: "Rust" }, f.d);
    expect(f.searchCalls()[0]?.args).toEqual([
      "annotations",
      "search",
      "commit",
      "--format",
      "json",
      "--search",
      '(tags:"=Rust") and not search:"=-hidden"',
    ]);
    expect(sc(r)).toMatchObject({ filter: "Rust", exclusionsApplied: ["-hidden"] });
    expect(textOf(r)).toContain("exclusions applied: [-hidden]");
    expect(textOf(r)).toContain("filter: Rust");
  });

  it("should_apply_exclusion_markers_without_a_filter", async () => {
    const f = deps(() => raw("annotations-search-commit"));
    await run({ query: "commit", mode: "annotations" }, f.d);
    expect(f.searchCalls()[0]?.args.slice(-2)).toEqual(["--search", 'not search:"=-hidden"']);
  });

  it("should_search_one_book_with_scope_book", async () => {
    const f = deps(() => raw("annotations-search-scoped"));
    const r = await run({ query: "commit", mode: "annotations", scope: "book", bookId: 644 }, f.d);
    expect(f.searchCalls()[0]?.args).toEqual([
      "annotations",
      "search",
      "commit",
      "--format",
      "json",
      "--search",
      "id:644",
    ]);
    expect((sc(r).annotations as Array<{ id: number }>).map((a) => a.id)).toEqual([23]);
  });

  it("should_refuse_a_cursor", async () => {
    const r = await run(
      { query: "commit", mode: "annotations", cursor: "abc" },
      deps(() => raw("annotations-search-commit")).d,
    );
    expect(sc(r)).toMatchObject({ errorCode: "invalid_input" });
  });
});

describe("calibre_search mode=notes (#500)", () => {
  it("should_run_calibredb_notes_search_on_the_resolved_library_id", async () => {
    const f = deps(() => raw("notes-search-outbox"));
    await run({ query: "outbox", mode: "notes" }, f.d);
    expect(f.calls).toEqual([{ args: ["notes", "search", "outbox"], library: "Programming_Books" }]);
  });

  it("should_return_field_item_and_snippet_per_hit", async () => {
    const r = await run({ query: "outbox", mode: "notes" }, deps(() => raw("notes-search-outbox")).d);
    expect(sc(r).notes).toEqual([
      {
        field: "authors",
        item: "Adam Bellemare",
        snippet:
          "…data contracts, the transactional outbox, event streams as the source of truth. More: https://www.oreilly.com/pub/au/7739",
      },
    ]);
  });

  it("should_show_the_hit_in_the_text_channel", async () => {
    const t = textOf(await run({ query: "outbox", mode: "notes" }, deps(() => raw("notes-search-outbox")).d));
    expect(t).toContain("note · authors: Adam Bellemare");
    expect(t).toContain("the transactional outbox");
  });

  it("should_refuse_a_filter_because_notes_attach_to_items_not_books", async () => {
    const r = await run({ query: "outbox", mode: "notes", filter: "Rust" }, deps(() => raw("notes-search-outbox")).d);
    expect(sc(r)).toMatchObject({ errorCode: "invalid_input" });
  });

  it("should_not_run_the_exclusion_sweep", async () => {
    const f = deps(() => raw("notes-search-outbox"));
    await run({ query: "outbox", mode: "notes" }, f.d);
    expect(f.calls.map((c) => c.args[0])).toEqual(["notes"]);
  });
});

describe("Calibre version gate on annotations and notes (#500)", () => {
  const old = parseCalibreVersion("calibredb (calibre 9.11)");

  it.each([["annotations"], ["notes"]])("should_refuse_mode_%s_on_calibre_9_11_before_any_spawn", async (mode) => {
    const f = deps(() => "", old);
    const r = await run({ query: "commit", mode }, f.d);
    expect({ code: sc(r).errorCode, calls: f.calls.length }).toEqual({ code: "calibre_too_old", calls: 0 });
    expect(textOf(r)).toContain("requires Calibre 9.18+ (found 9.11)");
  });

  it("should_run_when_the_version_is_unknown", async () => {
    const r = await run(
      { query: "commit", mode: "annotations" },
      deps(() => raw("annotations-search-commit"), "unknown").d,
    );
    expect(r.isError).not.toBe(true);
  });
});
