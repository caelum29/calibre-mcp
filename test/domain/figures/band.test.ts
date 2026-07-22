// Band-crop geometry tests (probe #77): bbox parsing, lowest-match anchor
// selection (both probe failures were in-text references stealing the anchor),
// and prev-caption band bounding. Fixture coordinates mimic pdftotext -bbox.

import { describe, expect, it } from "vitest";
import {
  computeBand,
  findAnchors,
  parseBboxPage,
  selectAnchor,
} from "../../../src/domain/figures/band.js";

function bbox(words: Array<[number, number, number, number, string]>): string {
  const w = words
    .map(([x0, y0, x1, y1, t]) => `<word xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y1}">${t}</word>`)
    .join("\n");
  return `<page width="612.000000" height="792.000000">\n${w}\n</page>`;
}

describe("parseBboxPage", () => {
  it("parses page dims and words", () => {
    const page = parseBboxPage(bbox([[72, 100, 110, 112, "Figure"]]));
    expect(page?.width).toBe(612);
    expect(page?.height).toBe(792);
    expect(page?.words).toEqual([{ x0: 72, y0: 100, x1: 110, y1: 112, text: "Figure" }]);
  });

  it("returns null without a page tag", () => {
    expect(parseBboxPage("<html></html>")).toBeNull();
  });
});

describe("findAnchors + selectAnchor", () => {
  it("prefers the caption with text over a bare wrapped reference above (DDIA failure)", () => {
    // prose ends with a wrapped "Figure 3-8." (no text after), real caption lower
    const page = parseBboxPage(
      bbox([
        [400, 200, 440, 212, "Figure"],
        [444, 200, 464, 212, "3-8."],
        [72, 500, 110, 512, "Figure"],
        [114, 500, 134, 512, "3-8."],
        [138, 500, 200, 512, "Splitting"],
      ]),
    );
    const anchor = selectAnchor(findAnchors(page!, "3-8"));
    expect(anchor?.y0).toBe(500);
    expect(anchor?.hasTextAfter).toBe(true);
  });

  it("takes the lowest match when several have text (reference in prose above)", () => {
    const page = parseBboxPage(
      bbox([
        [72, 150, 110, 162, "Figure"],
        [114, 150, 134, 162, "2.1"],
        [138, 150, 200, 162, "shows"],
        [72, 600, 110, 612, "Figure"],
        [114, 600, 134, 612, "2.1"],
        [138, 600, 220, 612, "Topology"],
      ]),
    );
    expect(selectAnchor(findAnchors(page!, "2.1"))?.y0).toBe(600);
  });

  it("matches the fused RU form (рис.15.7)", () => {
    const page = parseBboxPage(
      bbox([
        [72, 300, 130, 312, "рис.15.7"],
        [134, 300, 220, 312, "Схема"],
      ]),
    );
    expect(findAnchors(page!, "15.7")).toHaveLength(1);
  });

  it("returns null when the label never appears", () => {
    const page = parseBboxPage(bbox([[72, 100, 110, 112, "prose"]]));
    expect(selectAnchor(findAnchors(page!, "9-9"))).toBeNull();
  });
});

describe("computeBand", () => {
  it("spans page top to the caption bottom when nothing is above", () => {
    const page = parseBboxPage(bbox([[72, 500, 134, 512, "Figure"]]))!;
    const band = computeBand(page, { y0: 500, y1: 512, hasTextAfter: true }, []);
    expect(band.top).toBe(0);
    expect(band.bottom).toBe(515); // +3pt pad
  });

  it("starts below the previous caption on the same page", () => {
    const page = parseBboxPage(bbox([[72, 500, 134, 512, "Figure"]]))!;
    const band = computeBand(page, { y0: 500, y1: 512, hasTextAfter: true }, [
      { y0: 180, y1: 192, hasTextAfter: true },
    ]);
    expect(band.top).toBe(192);
  });

  it("ignores anchors below the target", () => {
    const page = parseBboxPage(bbox([[72, 300, 134, 312, "Figure"]]))!;
    const band = computeBand(page, { y0: 300, y1: 312, hasTextAfter: true }, [
      { y0: 600, y1: 612, hasTextAfter: true },
    ]);
    expect(band.top).toBe(0);
  });
});
