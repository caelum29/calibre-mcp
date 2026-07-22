// Inventory builder tests. The pdfimages -list fixture mirrors real probe output
// (Software Architecture Metrics: cover image+smask, then per-page figure rasters).

import { describe, expect, it } from "vitest";
import { buildInventory, detectScanned, parsePdfImagesList } from "../../../src/domain/figures/inventory.js";

const LIST_FIXTURE = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   1     0 image    1955  1080  rgb     3   8  jpeg   no      4719  0   300   300  812K  13%
   1     1 smask    1955  1080  gray    1   8  image  no      4719  0   300   300  102K 5.0%
   2     2 image    1267   408  rgb     3   8  image  no       151  0   300   300 41.3K 2.7%
   3     3 image    1268   354  rgb     3   8  image  no       201  0   300   300 33.7K 2.6%
   3     4 image    1270   852  rgb     3   8  image  no       219  0   300   300 68.9K 2.2%
`;

describe("parsePdfImagesList", () => {
  it("parses rows and skips the header", () => {
    const rasters = parsePdfImagesList(LIST_FIXTURE);
    expect(rasters).toHaveLength(5);
    expect(rasters[0]).toMatchObject({ page: 1, num: 0, type: "image", width: 1955, height: 1080 });
    expect(rasters[1]?.type).toBe("smask");
  });
});

describe("buildInventory", () => {
  // page 1: uncaptioned cover; page 2: one caption + one raster; page 3: two rasters, one caption
  const text = [
    "cover page",
    "prose\nFigure 1-1. The fundamental mental model\nmore prose",
    "Figure 1-2: Second figure\ntext",
  ].join("\f");

  it("pairs captions with image rows per page, in order; smask rows never count", () => {
    const inv = buildInventory(text, parsePdfImagesList(LIST_FIXTURE));
    const figures = inv.entries.filter((e) => e.captioned);
    expect(figures).toHaveLength(2);
    expect(figures[0]).toMatchObject({ page: 2, caption: "The fundamental mental model", source: "raster", pdfImageNum: 2 });
    expect(figures[1]).toMatchObject({ page: 3, label: "1-2", source: "raster", pdfImageNum: 3 });
  });

  it("buckets leftover rasters as uncaptioned (cover, second page-3 raster)", () => {
    const inv = buildInventory(text, parsePdfImagesList(LIST_FIXTURE));
    const uncaptioned = inv.entries.filter((e) => !e.captioned);
    expect(uncaptioned.map((e) => e.page)).toEqual([1, 3]);
    expect(inv.counts).toMatchObject({ figures: 2, uncaptioned: 2, pageRender: 0 });
  });

  it("turns caption-without-raster into a page-render entry (vector figure)", () => {
    const vectorText = ["intro", "Figure 2-1. A vector diagram"].join("\f");
    const inv = buildInventory(vectorText, []);
    expect(inv.entries).toHaveLength(1);
    expect(inv.entries[0]).toMatchObject({ captioned: true, source: "page-render", page: 2 });
    expect(inv.counts.pageRender).toBe(1);
  });

  it("keeps one stable document-ordered index space", () => {
    const inv = buildInventory(text, parsePdfImagesList(LIST_FIXTURE));
    expect(inv.entries.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    expect(inv.pageCount).toBe(3);
  });
});

describe("detectScanned", () => {
  const imagePerPage = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ page: i + 1, num: i, type: "image", width: 2000, height: 2800 }));

  it("flags caption-less image-per-page books with no text", () => {
    const pages = Array.from({ length: 10 }, () => "");
    expect(detectScanned(pages, [], imagePerPage(10))).toBe(true);
  });

  it("does not flag normal books with text or captions", () => {
    const pages = Array.from({ length: 10 }, () => "long prose ".repeat(40));
    expect(detectScanned(pages, [], imagePerPage(10))).toBe(false);
    expect(detectScanned(Array.from({ length: 10 }, () => ""), [{ page: 1, label: "1", text: "x" }], imagePerPage(10))).toBe(false);
  });
});
