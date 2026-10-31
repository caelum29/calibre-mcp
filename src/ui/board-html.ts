// Cover-board widget for the MCP Apps iframe (issues #19/#22/#53). ONE HTML document ships
// BOTH visual variants — "shelf" (carousel) and "coverflow" (3D cover flow) — with a runtime
// toggle (the .vswitch pill). CALIBRE_MCP_BOARD_STYLE picks only the INITIAL variant; the
// client-side toggle keeps the served resource static, so per-call switching stays spec-legal
// (issues #24/#53). Both variants share one MCP plumbing core: appInfo handshake, data pull via
// widget-initiated tools/call (Desktop strips structuredContent from the tool-result
// notification), card click → ui/message "Show me book …" (#130), Open → calibre_open_book (a tools/call, never a
// link, so it never degrades), Search-inside → ui/message. SDK-free; served by server.ts as two
// ui:// resources (one per search tool, so the widget knows its tool without guessing).
// Injection hygiene: all book fields land via textContent/createElement — no innerHTML, no eval.
// The CSS/JS live as real files in src/ui/board/ and are inlined at build (#271).

import { BOARD_TEMPLATE, DEBUG_JS } from "./generated/widgets.js";

export const BOARD_KEYWORD_URI = "ui://calibre/board-keyword.html";
export const BOARD_SEMANTIC_URI = "ui://calibre/board-semantic.html";

/** Cover-board visual style; picks the INITIAL variant (config.boardStyle), toggled at runtime. */
export type BoardStyle = "shelf" | "coverflow";

/** Render the board template for one owning search tool, with an initial variant. */
export function boardHtml(
  tool: "calibre_search" | "calibre_semantic_search",
  version: string,
  style: BoardStyle = "shelf",
  debug = false,
): string {
  return BOARD_TEMPLATE.replaceAll("__TOOL__", tool)
    .replaceAll("__VERSION__", version)
    .replaceAll("__VARIANT__", style)
    .replaceAll("__DEBUG__", debug ? DEBUG_JS : "");
}
