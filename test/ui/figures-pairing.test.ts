// #537: Claude Desktop regroups the tool-result content[] before the figures viewer sees it —
// every text block first, then every image — so the viewer pairs `Figure index …` lines with
// images by order, not by adjacency. The grouped payload below was captured live in Desktop.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../src/ui/figures/figures.js", import.meta.url), "utf8");

/** Pull one top-level piece of the viewer script out by its opening text (2-space indented body). */
function piece(re: RegExp): string {
  const m = re.exec(src);
  if (!m) throw new Error(`figures.js: ${re} not found`);
  return m[0];
}

interface Item {
  index: number | null;
  loc?: string;
  caption?: string;
  url?: string;
  skipped?: string;
}

const code = [
  piece(/var RE_FIG = [^\n]*;/),
  piece(/var RE_SKIP = [^\n]*;/),
  piece(/function parseFigures\(blocks\) \{[\s\S]*?\n {2}\}/),
  piece(/function parseCaption\(m\) \{[\s\S]*?\n {2}\}/),
].join("\n");
const parseFigures = new Function(`${code}\nreturn parseFigures;`)() as (blocks: unknown[]) => Item[];

const text = (t: string) => ({ type: "text", text: t });
const image = (d: string) => ({ type: "image", mimeType: "image/webp", data: d });

const HEADER = text("Book 755 (epub): returned 3/3 figures at detail=standard.");
const CAP_1 = text(
  "Figure index 1 (§23, raster, image/jpeg 29.7 KB) — Figure 1-1: The business differentiation and business logic complexity of the three types of subdomains",
);
const CAP_10 = text(
  "Figure index 10 (§50, raster, image/jpeg 22.1 KB) — Figure 3-3: Tackling inconsistencies in the ubiquitous language by splitting it into bounded contexts",
);
const CAP_25 = text("Figure index 25 (§79, raster, image/jpeg 44.5 KB) — Figure 4-8: Context map");
const STEER = text("The image(s) above are attached to this result — look at them before answering.");

// The order Claude Desktop delivered on 2026-11-12 (dev bundle 0.12.1-dev1421).
const desktopGrouped = [HEADER, CAP_1, CAP_10, CAP_25, STEER, image("AAA"), image("BBB"), image("CCC")];
// The order the server emits.
const serverInterleaved = [HEADER, CAP_1, image("AAA"), CAP_10, image("BBB"), CAP_25, image("CCC"), STEER];

describe("figures viewer pairs captions with images by order (#537)", () => {
  it("should_number_each_figure_when_desktop_groups_texts_before_images", () => {
    expect(parseFigures(desktopGrouped).map((f) => f.index)).toEqual([1, 10, 25]);
  });

  it("should_keep_the_section_of_each_figure_when_desktop_groups_texts_before_images", () => {
    expect(parseFigures(desktopGrouped).map((f) => f.loc)).toEqual(["§23", "§50", "§79"]);
  });

  it("should_keep_the_caption_with_its_image_when_desktop_groups_texts_before_images", () => {
    const third = parseFigures(desktopGrouped)[2];
    expect([third?.caption, third?.url]).toEqual(["Figure 4-8: Context map", "data:image/webp;base64,CCC"]);
  });

  it("should_number_each_figure_in_the_order_the_server_emits", () => {
    expect(parseFigures(serverInterleaved).map((f) => f.index)).toEqual([1, 10, 25]);
  });

  it("should_not_give_a_skipped_figure_an_image", () => {
    const blocks = [HEADER, CAP_1, text("Figure index 7 skipped: vector figure"), CAP_25, image("AAA"), image("CCC")];
    expect(parseFigures(blocks).map((f) => [f.index, f.url ?? f.skipped])).toEqual([
      [1, "data:image/webp;base64,AAA"],
      [25, "data:image/webp;base64,CCC"],
      [7, "vector figure"],
    ]);
  });

  it("should_still_show_an_image_that_has_no_caption_line", () => {
    expect(parseFigures([HEADER, image("AAA")]).map((f) => f.index)).toEqual([null]);
  });

  it("should_return_nothing_for_an_empty_result", () => {
    expect(parseFigures([])).toEqual([]);
  });
});
