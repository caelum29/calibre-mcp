// #553: the figures viewer reads the location from the `Figure index …` line — `§N` for an
// EPUB section, `p.N` for a PDF page — and shows it as delivered, never relabelling § as p.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../src/ui/figures/figures.js", import.meta.url), "utf8");

/** Pull one top-level piece of the viewer script out by its opening text (2-space indented body). */
function piece(re: RegExp): string {
  const m = re.exec(src);
  if (!m) throw new Error(`figures.js: ${re} not found`);
  return m[0];
}

const code = [
  piece(/var RE_FIG = [^\n]*;/),
  piece(/function parseCaption\(m\) \{[\s\S]*?\n {2}\}/),
  piece(/function provText\(f\) \{[\s\S]*?\n {2}\}/),
].join("\n");
const api = new Function(`${code}\nreturn { RE_FIG: RE_FIG, parseCaption: parseCaption, provText: provText };`)() as {
  RE_FIG: RegExp;
  parseCaption: (m: RegExpExecArray) => Record<string, unknown>;
  provText: (f: Record<string, unknown>) => string;
};

const prov = (line: string) => api.provText(api.parseCaption(api.RE_FIG.exec(line)!));

describe("figures viewer location label (#553)", () => {
  it("should_show_an_epub_section_as_section", () => {
    expect(prov("Figure index 0 (§5, raster, image/png 2.0 KB) — Figure 1-1: A model")).toBe("§5 · raster");
  });

  it("should_show_a_pdf_page_as_before", () => {
    expect(prov("Figure index 3 (p.35, raster, image/jpeg 132.0 KB) — Figure 1.1: Clean Architecture")).toBe(
      "p.35 · raster",
    );
  });

  it("should_show_a_question_mark_when_the_line_has_no_location", () => {
    expect(prov("Figure index 2 (, raster, image/png 1.0 KB, uncaptioned)")).toBe("? · raster");
  });
});
