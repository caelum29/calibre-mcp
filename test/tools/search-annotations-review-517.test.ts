// Review fixes for PR #517 (#500): user text never becomes a calibredb flag (`--` before a
// positional that starts with "-"), FTS5 syntax errors are the caller's input, and the JSON
// parsers tolerate lines around the JSON. Error fixtures are real captures.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { log } from "../../src/logging.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";
import { parseAnnotationExport, parseAnnotationSearch } from "../../src/calibre/annotations.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { SearchDeps } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const FIX = path.join(import.meta.dirname, "../calibre/fixtures/annotations-notes-500");
const file = (name: string) => readFileSync(path.join(FIX, name), "utf8");

type Calibredb = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

function deps(calibredb: Calibredb) {
  invalidateBundleCache();
  const calls: string[][] = [];
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
        calls.push([...args]);
        if (args[0] === "saved_searches") return { stdout: "Integration status: False\n", stderr: "" };
        return calibredb([...args]);
      },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  } as unknown as SearchDeps;
  return { d, calls: () => calls.filter((c) => c[0] !== "saved_searches") };
}

const empty: Calibredb = async () => ({ stdout: "Integration status: False\n[]\n", stderr: "" });
const textOf = (r: ToolResult) => r.content.map((b) => ("text" in b ? b.text : "")).join("\n");
const sc = (r: ToolResult) => r.structuredContent as Record<string, unknown>;
const run = (args: Record<string, unknown>, d: SearchDeps) =>
  searchTool.handler({ scope: "library", limit: 20, ...args } as never, d as never);

/** calibredb failing the way the client reports it: exit 1, stdout + stderr joined (calibre/client.ts). */
const capturedFailure =
  (name: string): Calibredb =>
  async () => {
    throw new CalibreCliError(1, "calibredb command failed", [file(`${name}.raw`), file(`${name}.err`)].join("\n"));
  };

describe("user text is never a calibredb flag (#517 review)", () => {
  it("should_end_the_annotations_search_argv_with_dashdash_and_the_query", async () => {
    const f = deps(empty);
    await run({ query: "--help", mode: "annotations", include_excluded: true }, f.d);
    expect(f.calls()).toEqual([["annotations", "search", "--format", "json", "--", "--help"]]);
  });

  it("should_keep_the_book_restriction_before_dashdash", async () => {
    const f = deps(empty);
    await run({ query: "-s", mode: "annotations", scope: "book", bookId: 644 }, f.d);
    expect(f.calls()).toEqual([["annotations", "search", "--format", "json", "--search", "id:644", "--", "-s"]]);
  });

  it("should_end_the_notes_search_argv_with_dashdash_and_the_query", async () => {
    const f = deps(async () => ({ stdout: "Integration status: False\n", stderr: "" }));
    await run({ query: "--help", mode: "notes" }, f.d);
    expect(f.calls()).toEqual([["notes", "search", "--", "--help"]]);
  });

  it("should_put_dashdash_between_the_field_and_a_dash_item_in_notes_show", async () => {
    const f = deps(async () => ({ stdout: "Integration status: False\nnote\n", stderr: "" }));
    await run({ query: "authors:--help", mode: "notes" }, f.d);
    expect(f.calls()).toEqual([["notes", "show", "authors", "--", "--help"]]);
  });
});

describe("FTS5 syntax errors are invalid_input (#517 review)", () => {
  it.each([
    ["commit -", "annotations-search-bad-fts5"],
    ["--help", "annotations-search-dashdash-help"],
  ])("should_map_a_bad_annotation_query_%s_to_invalid_input_with_a_steer", async (query, capture) => {
    const r = await run({ query, mode: "annotations" }, deps(capturedFailure(capture)).d);
    expect(sc(r)).toMatchObject({ errorCode: "invalid_input" });
    expect(textOf(r)).toContain(`Calibre could not parse the search query ${JSON.stringify(query)}`);
    expect(textOf(r)).toContain("plain words");
  });

  it("should_map_a_bad_notes_query_to_invalid_input", async () => {
    const r = await run({ query: "commit -", mode: "notes" }, deps(capturedFailure("annotations-search-bad-fts5")).d);
    expect(sc(r)).toMatchObject({ errorCode: "invalid_input" });
  });
});

describe("JSON parsers tolerate lines around the JSON (#517 review)", () => {
  it("should_parse_an_empty_search_array_followed_by_a_warning_line", () => {
    expect(parseAnnotationSearch("Integration status: False\n[]\nwarn: something\n")).toEqual([]);
  });

  it("should_parse_a_search_array_followed_by_a_warning_line", () => {
    const stdout = `${file("annotations-search-bookmark.raw")}warn: something [x] {y}\n`;
    expect(parseAnnotationSearch(stdout).map((a) => a.id)).toEqual([17]);
  });

  it("should_parse_an_export_object_followed_by_a_warning_line", () => {
    const stdout = `${file("annotations-export.raw")}warn: trailing }\n`;
    expect(parseAnnotationExport(stdout)).toHaveLength(17);
  });

  it("should_end_a_search_with_a_trailing_line_as_zero_hits_not_internal", async () => {
    const f = deps(async () => ({ stdout: "Integration status: False\n[]\nwarn\n", stderr: "" }));
    const r = await run({ query: "zzzz", mode: "annotations" }, f.d);
    expect({ isError: r.isError === true, total: sc(r).total }).toEqual({ isError: false, total: 0 });
  });
});
