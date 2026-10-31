// Figures widget for calibre_get_figures (map #109, ticket #112): the fetch mirror —
// the user sees exactly the ≤3 figures the model fetched. Visuals are the approved v2
// mockup (docs/dev/design/figures-widget-v2.html — reading pane + margin rail; devbar,
// fake data and the SVG placeholder generator removed), with the mockup seams wired to
// MCP plumbing: data comes from the ui/notifications/tool-result content[] (probe #111 —
// text/image pairs survive intact, structuredContent/_meta do not), so there is no
// re-call and no cache. List mode (tool-input without indexes) carries no images, so the
// widget collapses to zero height. Injection hygiene as in the board/card widgets:
// no console, no innerHTML for data, no template literals in the widget JS. The CSS/JS live
// as real files in src/ui/figures/ and are inlined at build (#271).

import { FIGURES_TEMPLATE, DEBUG_JS } from "./generated/widgets.js";

export const FIGURES_URI = "ui://calibre/figures.html";

/** Render the figures-widget template. */
export function figuresHtml(version: string, debug = false): string {
  return FIGURES_TEMPLATE.replaceAll("__VERSION__", version).replaceAll("__DEBUG__", debug ? DEBUG_JS : "");
}
