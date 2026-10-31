// Book-card widget for calibre_get_book (issues #19/#22). Visuals are the approved
// mockup (docs/dev/design/card-buttons.html — CSS/markup frozen, devbar + fixtures +
// wave/rail variants removed) with the fake layer replaced by MCP plumbing: appInfo
// handshake, data via structuredContent or a silent widget-initiated re-call (Desktop
// strips the tool-result notification). Action-button layer (issue #53): Open in the
// local viewer is the primary that NEVER hides (tools/call calibre_open_book; one Open
// per format when the book has several, so the user picks what opens); per-format
// Read/⬇ pairs + cover zoom degrade under data-noread; Similar + Search-inside + the
// curation row route through ui/message and degrade under data-nomsg. Injection hygiene:
// every book field lands via textContent/createElement. The CSS/JS live as real files in
// src/ui/card/ and are inlined at build (#271).

import { CARD_TEMPLATE, DEBUG_JS } from "./generated/widgets.js";

export const CARD_URI = "ui://calibre/book-card.html";

/** Render the book-card template. */
export function cardHtml(version: string, debug = false): string {
  return CARD_TEMPLATE.replaceAll("__VERSION__", version).replaceAll("__DEBUG__", debug ? DEBUG_JS : "");
}
