// #518: the `--` guard now covers calibre_add_book and calibre_merge_books. Absolute paths keep the
// exact argv they had; a path starting with "-" (unreachable through CALIBRE_MCP_ADD_ROOTS) gets `--`.
import { describe, expect, it } from "vitest";
import { calibredbArgv } from "../../src/calibre/calibredb-argv.js";

describe("calibredbArgv", () => {
  it("should_keep_add_argv_for_an_absolute_path", () => {
    expect(calibredbArgv(["add"], ["/books/a.epub"])).toEqual(["add", "/books/a.epub"]);
  });
  it("should_keep_add_format_argv_with_options_in_the_head", () => {
    expect(calibredbArgv(["add_format", "--dont-replace"], ["10", "/tmp/12.pdf"])).toEqual([
      "add_format",
      "--dont-replace",
      "10",
      "/tmp/12.pdf",
    ]);
  });
  it("should_end_option_parsing_before_a_dash_leading_path", () => {
    expect(calibredbArgv(["add"], ["-x.epub"])).toEqual(["add", "--", "-x.epub"]);
  });
  it("should_put_options_before_the_separator_for_dash_text", () => {
    expect(calibredbArgv(["annotations", "search"], ["--help"], ["--format", "json"])).toEqual([
      "annotations",
      "search",
      "--format",
      "json",
      "--",
      "--help",
    ]);
  });
});
