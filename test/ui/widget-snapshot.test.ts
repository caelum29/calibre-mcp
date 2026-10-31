// Rendered-widget snapshot (issue #271): the HTML each widget serves must stay byte-equivalent,
// modulo whitespace, when its CSS/JS moves out of template strings into real files.
// Snapshots are plain files read as-is — never auto-written, so a drift fails instead of updating.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { boardHtml } from "../../src/ui/board-html.js";
import { cardHtml } from "../../src/ui/card-html.js";
import { figuresHtml } from "../../src/ui/figures-html.js";

const VERSION = "9.9.9-snap";
const SNAP_DIR = new URL("./__snapshots__/widgets/", import.meta.url);

// Whitespace-only normalization: every run of whitespace becomes one space, ends trimmed.
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const snapshot = (name: string): string => readFileSync(new URL(name, SNAP_DIR), "utf8");

const cases: [name: string, render: () => string][] = [];
for (const debug of [false, true]) {
  const d = debug ? "debug" : "nodebug";
  for (const tool of ["calibre_search", "calibre_semantic_search"] as const) {
    for (const style of ["shelf", "coverflow"] as const) {
      cases.push([`board-${tool}-${style}-${d}.html`, () => boardHtml(tool, VERSION, style, debug)]);
    }
  }
  cases.push([`card-${d}.html`, () => cardHtml(VERSION, debug)]);
  cases.push([`figures-${d}.html`, () => figuresHtml(VERSION, debug)]);
}

describe("rendered widget HTML snapshot (#271)", () => {
  it.each(cases)("should_render_%s_equal_to_the_snapshot", (name, render) => {
    expect(norm(render())).toBe(norm(snapshot(name)));
  });

  it("should_cover_twelve_renders", () => {
    expect(cases).toHaveLength(12);
  });
});
