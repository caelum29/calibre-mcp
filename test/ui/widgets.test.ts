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
      expect(html).not.toContain("__DEBUG__");
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

  it("should_contain_the_single_result_hero_view", () => {
    // Issue #71: one identified book renders a card-like hero, not a one-book shelf.
    for (const html of boards) {
      expect(html).toContain('class="view view-hero"');
      expect(html).toContain('id="hOpen"');
      expect(html).toContain('data-state="hero"');
    }
  });

  it("should_collapse_on_count_only_searches", () => {
    // Issue #67: count answers are aggregates — the board collapses on countOnly input.
    for (const html of boards) expect(html).toContain("countOnly");
  });

  it("should_offer_one_open_button_per_format_on_multi_format_books", () => {
    // A multi-format book must let the user pick which format opens — a bare Open
    // silently launches formats[0] and hides the rest.
    expect(card).toContain("formats.length > 1 ? formats");
    expect(card).toContain("args.format = btn.dataset.fmt");
  });

  it("should_defer_open_pending_state_past_a_threshold", () => {
    // Issue #70: the near-instant local open must not flash "Opening…" — the pending
    // state appears only when the call outlives the timeout, and never via :disabled.
    expect(card).toContain("dataset.busy");
    expect(card).toContain("is-busy");
    expect(card).not.toContain("btn.disabled = true");
  });

  it("should_degrade_link_and_message_buttons_only_on_method_not_found", () => {
    // Issues #69/#72 (probe 2026-07-21): Desktop resolves a successful ui/open-link with
    // {isError:true} and a successful ui/message with {} — a RESOLVED promise must never
    // hide buttons; only a -32601 rejection (host lacks the method) may degrade.
    for (const html of all) expect(html).toContain("-32601");
    expect(card).not.toContain('isError) document.body.dataset.noread');
    expect(card).not.toContain('isError) document.body.dataset.nomsg');
    for (const html of boards) expect(html).not.toContain("isError) noMsg()");
  });

  it("should_gate_message_buttons_on_the_initialize_capability", () => {
    // The reliable pre-emptive signal: hosts that declare capabilities but omit
    // ui/message get the msg layer hidden at boot instead of after a failed click.
    for (const html of all) expect(html).toContain("caps.message");
  });

  it("should_emit_valid_regex_escapes_not_double_backslashes", () => {
    // The TS template literal must collapse \\ to \ in the emitted JS (a stray double
    // backslash means the widget regex/string literals are broken).
    for (const html of all) expect(html).not.toContain("\\\\");
  });
});

describe("widget debug probe (issues #69/#72)", () => {
  const debugAll = [boardHtml("calibre_search", "9.9.9", "shelf", true), cardHtml("9.9.9", true)];

  it("should_contain_no_probe_code_when_debug_is_off", () => {
    for (const html of all) {
      expect(html).not.toContain("dbgLog");
      expect(html).not.toContain("calibre_widget_log");
    }
  });

  it("should_inject_the_probe_layer_when_debug_is_on", () => {
    for (const html of debugAll) {
      expect(html).toContain('dbgPre.id = "dbgLog"');
      expect(html).toContain("calibre_widget_log");
    }
  });

  it("should_keep_hygiene_rules_in_the_probe_layer", () => {
    for (const html of debugAll) {
      expect(html).not.toContain("console.");
      expect(html).not.toContain("innerHTML");
      expect(html).not.toContain("eval(");
      expect(html).not.toContain("\\\\");
    }
  });
});
