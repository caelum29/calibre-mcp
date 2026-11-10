// Characterization for #518: what every calibredb stdout parser accepts today around the
// "Integration status: False" banner (first, last, absent, trailing lines). Frozen: it pins the
// behaviour that the shared banner helper must keep, using real captures from #500.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnnotationExport, parseAnnotationSearch, parseNoteShow } from "../../src/calibre/annotations.js";
import { enableFts } from "../../src/app/enable-fts.js";
import { parseSavedSearches } from "../../src/app/bundles.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";

const FIX = path.join(import.meta.dirname, "fixtures/annotations-notes-500");
const raw = (name: string) => readFileSync(path.join(FIX, `${name}.raw`), "utf8");
const BANNER = "Integration status: False\n";
const bare = (s: string) => s.replace(/^Integration status: .*\n/, "");

describe("annotation JSON parsers (#518)", () => {
  it.each([
    ["banner first", raw("annotations-search-commit")],
    ["no banner", bare(raw("annotations-search-commit"))],
    ["trailing lines", `${raw("annotations-search-commit")}warn: trailing ]\n`],
  ])("should_parse_annotations_search_with_%s", (_n, out) => {
    expect(parseAnnotationSearch(out).length).toBe(
      parseAnnotationSearch(bare(raw("annotations-search-commit"))).length,
    );
    expect(parseAnnotationSearch(out).length).toBeGreaterThan(0);
  });

  it("should_throw_when_search_output_has_no_json", () => {
    expect(() => parseAnnotationSearch(BANNER)).toThrow("returned no JSON");
  });

  it.each([
    ["banner first", raw("annotations-export")],
    ["no banner", bare(raw("annotations-export"))],
    ["trailing lines", `${raw("annotations-export")}warn: trailing }\n`],
  ])("should_parse_annotations_export_with_%s", (_n, out) => {
    expect(parseAnnotationExport(out)).toHaveLength(17);
  });

  it("should_parse_export_json_followed_by_a_banner_line", () => {
    expect(parseAnnotationExport(`${bare(raw("annotations-export"))}${BANNER}`)).toHaveLength(17);
  });
});

describe("parseNoteShow (#518)", () => {
  const note = bare(raw("notes-show-bellemare"));
  it("should_drop_leading_banner_lines_and_trailing_whitespace", () => {
    expect(parseNoteShow(raw("notes-show-bellemare"))).toBe(note.trimEnd());
  });
  it("should_drop_several_leading_banner_lines", () => {
    expect(parseNoteShow(`${BANNER}${BANNER}${note}`)).toBe(note.trimEnd());
  });
  it("should_keep_a_banner_looking_line_inside_the_note", () => {
    expect(parseNoteShow(`${BANNER}a\nIntegration status: x\nb\n`)).toBe("a\nIntegration status: x\nb");
  });
  it("should_keep_a_trailing_banner_line_as_note_text", () => {
    expect(parseNoteShow(`a\n${BANNER}`)).toBe("a\nIntegration status: False");
  });
});

describe("version and saved-search parsers (#518)", () => {
  it.each([
    ["banner first", `${BANNER}calibredb (calibre 9.18)\n`],
    ["banner last", `calibredb (calibre 9.18)\n${BANNER}`],
    ["no banner", "calibredb (calibre 9.18)\n"],
  ])("should_read_the_version_with_%s", (_n, out) => {
    expect(parseCalibreVersion(out)).toMatchObject({ text: "9.18", major: 9, minor: 18 });
  });

  const saved = 'Name: Rust\nSearch string: tags:"=Rust"\n';
  it.each([
    ["banner first", `${BANNER}${saved}`],
    ["banner last", `${saved}${BANNER}`],
    ["no banner", saved],
  ])("should_list_saved_searches_with_%s", (_n, out) => {
    expect(parseSavedSearches(out)).toEqual([{ name: "Rust", expression: 'tags:"=Rust"' }]);
  });
});

describe("enableFts status parsing (#518)", () => {
  const run = (statusOut: string) =>
    enableFts(
      {
        writeEnabled: true,
        calibre: {
          calibredb: async (a: readonly string[]) => ({
            stdout: a[1] === "status" ? statusOut : "",
            stderr: "",
          }),
        } as never,
      },
      "Programming_Books" as never,
    );
  const line = "FTS is enabled\n1153 of 1153 books files indexed\n";
  it.each([
    ["banner first", `${BANNER}${line}`],
    ["banner last", `${line}${BANNER}`],
    ["no banner", line],
  ])("should_report_already_enabled_with_progress_with_%s", async (_n, out) => {
    expect(await run(out)).toEqual({ status: "already_enabled", progress: "1153 of 1153 books files indexed" });
  });
});
