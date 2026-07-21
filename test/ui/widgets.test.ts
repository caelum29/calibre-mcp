// Widget-template hygiene (issue #22): substitutions complete, injection-safe rendering
// (textContent only), correct handshake shape, and nothing that could pollute stdio.

import { describe, it, expect } from "vitest";
import { boardHtml, BOARD_KEYWORD_URI, BOARD_SEMANTIC_URI } from "../../src/ui/board-html.js";
import { cardHtml, CARD_URI } from "../../src/ui/card-html.js";

const board = boardHtml("calibre_search", "9.9.9");
const semanticBoard = boardHtml("calibre_semantic_search", "9.9.9");
const coverflow = boardHtml("calibre_search", "9.9.9", "coverflow");
const semanticCoverflow = boardHtml("calibre_semantic_search", "9.9.9", "coverflow");
const card = cardHtml("9.9.9");
const boards = [board, semanticBoard, coverflow, semanticCoverflow];
const all = [...boards, card];

describe("widget templates", () => {
  it("should_substitute_all_placeholder_tokens", () => {
    for (const html of all) {
      expect(html).not.toContain("__TOOL__");
      expect(html).not.toContain("__VERSION__");
      expect(html).not.toContain("__VARIANT__");
    }
  });

  it("should_bind_each_board_to_its_owning_tool", () => {
    expect(board).toContain('var TOOL = "calibre_search"');
    expect(semanticBoard).toContain('var TOOL = "calibre_semantic_search"');
    expect(coverflow).toContain('var TOOL = "calibre_search"');
    expect(semanticCoverflow).toContain('var TOOL = "calibre_semantic_search"');
  });

  it("should_set_initial_variant_from_style", () => {
    // Both variants ship in every board doc (issue #53); style only picks the boot variant.
    expect(board).toContain('data-variant="shelf"');
    expect(coverflow).toContain('data-variant="coverflow"');
  });

  it("should_contain_both_variant_views_in_one_doc", () => {
    for (const html of boards) {
      expect(html).toContain('id="strip"');
      expect(html).toContain('id="fstage"');
      expect(html).toContain('class="vswitch"');
    }
  });

  it("should_wire_open_button_to_the_hidden_open_book_tool", () => {
    for (const html of all) expect(html).toContain("calibre_open_book");
  });

  it("should_never_use_innerHTML_or_eval", () => {
    for (const html of all) {
      expect(html).not.toContain("innerHTML");
      expect(html).not.toContain("eval(");
      expect(html).not.toContain("document.write");
    }
  });

  it("should_not_log_to_console", () => {
    for (const html of all) expect(html).not.toContain("console.");
  });

  it("should_handshake_with_appInfo_not_clientInfo", () => {
    for (const html of all) {
      expect(html).toContain("appInfo");
      expect(html).toContain('"2026-01-26"');
      expect(html).not.toContain("clientInfo");
    }
  });

  it("should_have_distinct_ui_uris", () => {
    expect(new Set([BOARD_KEYWORD_URI, BOARD_SEMANTIC_URI, CARD_URI]).size).toBe(3);
    for (const uri of [BOARD_KEYWORD_URI, BOARD_SEMANTIC_URI, CARD_URI]) {
      expect(uri.startsWith("ui://calibre/")).toBe(true);
    }
  });

  it("should_pull_data_via_the_hidden_board_data_tool", () => {
    for (const html of boards) expect(html).toContain("calibre_board_data");
  });

  it("should_collapse_on_zero_result_searches", () => {
    // Issue #68: zero results never populate the board cache — the widget must
    // recognize them and collapse instead of erroring after a futile re-run.
    for (const html of boards) expect(html).toContain("isZeroResult");
  });

  it("should_emit_valid_regex_escapes_not_double_backslashes", () => {
    // The TS template literal must collapse \\ to \ in the emitted JS (a stray double
    // backslash means the widget regex/string literals are broken).
    for (const html of all) expect(html).not.toContain("\\\\");
  });
});
