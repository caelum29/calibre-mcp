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
    "prose\nFigure 1-1. The fundamental mental model\nMore prose.",
    "Figure 1-2: Second figure\ntext",
  ].join("\f");

  it("pairs captions with image rows per page, in order; smask rows never count", () => {
    const inv = buildInventory(text, parsePdfImagesList(LIST_FIXTURE));
    const figures = inv.entries.filter((e) => e.captioned);
    expect(figures).toHaveLength(2);
    expect(figures[0]).toMatchObject({
      page: 2,
      caption: "The fundamental mental model",
      source: "raster",
      pdfImageNum: 2,
    });
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

// #422: magazine pages build one figure from dozens of raster tiles (Science #6667 p.89),
// or carry a lone section banner next to a vector figure (p.9). Rows mirror real probe output.
const row = (page: number, num: number, w: number, h: number, ppi = 300) =>
  `  ${page}  ${num} image  ${w}  ${h}  icc  3  8  jpeg  no  ${7000 + num}  0  ${ppi}  ${ppi}  1K  5%`;
const listOf = (...rows: string[]) => `page num type width height\n----\n${rows.join("\n")}\n`;

describe("buildInventory — implausible rasters (#422)", () => {
  it("parses x/y ppi when present", () => {
    const [r] = parsePdfImagesList(listOf(row(1, 0, 600, 300, 150)));
    expect(r).toMatchObject({ xPpi: 150, yPpi: 150 });
  });

  it("parses ppi of inline images, whose object column is one token", () => {
    const inline = " 104    12 image      12    12  devn    3   8  image  no   [inline]     106   106  213B  49%";
    const [r] = parsePdfImagesList(listOf(inline));
    expect(r).toMatchObject({ xPpi: 106, yPpi: 106 });
  });

  it("renders the page for a caption whose paired raster is a colour-bar strip", () => {
    const text = ["", "Fig. 2. Superclusters and clusters are differentially distributed."].join("\f");
    const inv = buildInventory(text, parsePdfImagesList(listOf(row(2, 0, 109, 11), row(2, 1, 193, 70))));
    expect(inv.entries[0]).toMatchObject({ captioned: true, source: "page-render", pdfImageNum: 0 });
    expect(inv.entries[0]?.width).toBeUndefined();
    expect(inv.counts.pageRender).toBe(1);
  });

  it("renders the page for a lone section banner (one raster, one caption)", () => {
    const text = ["", "Fig. 2. Cell type-specific differences in abundance across donors."].join("\f");
    const inv = buildInventory(text, parsePdfImagesList(listOf(row(2, 0, 396, 135))));
    expect(inv.entries[0]).toMatchObject({ source: "page-render" });
  });

  it("keeps a full-size raster figure, including a low-ppi one", () => {
    const text = ["", "Fig. 1. Cell atlas of macaque telencephalon."].join("\f");
    const big = buildInventory(text, parsePdfImagesList(listOf(row(2, 0, 1411, 2055))));
    expect(big.entries[0]).toMatchObject({ source: "raster", width: 1411 });
    const lowRes = buildInventory(text, parsePdfImagesList(listOf(row(2, 0, 400, 300, 72))));
    expect(lowRes.entries[0]).toMatchObject({ source: "raster" });
  });

  it("renders the page when a big raster sits among composite fragments (gradient backdrop)", () => {
    const text = ["", "Fig. 3. Observation of nonlocal fermion pairing."].join("\f");
    const rows = [row(2, 0, 1226, 857), row(2, 1, 22, 516), row(2, 2, 22, 516)];
    const inv = buildInventory(text, parsePdfImagesList(listOf(...rows)));
    expect(inv.entries[0]).toMatchObject({ source: "page-render" });
  });

  it("keeps a book screenshot that shares its page with one small icon", () => {
    const text = ["", "Figure 4-2. CloudFront distribution status during an update"].join("\f");
    const rows = [row(2, 0, 1650, 192), row(2, 1, 60, 60)];
    const inv = buildInventory(text, parsePdfImagesList(listOf(...rows)));
    expect(inv.entries[0]).toMatchObject({ source: "raster", pdfImageNum: 0 });
  });

  it("keeps entry count, order and indexes stable — the semantic index and markers point at them", () => {
    const text = ["", "Fig. 2. A composite figure."].join("\f");
    const rows = [row(2, 0, 109, 11), row(2, 1, 22, 516), row(2, 2, 200, 516)];
    const inv = buildInventory(text, parsePdfImagesList(listOf(...rows)));
    // same shape as before the fix: 1 captioned slot that consumed raster 0, then the leftovers
    expect(inv.entries.map((e) => [e.index, e.captioned, e.pdfImageNum])).toEqual([
      [0, true, 0],
      [1, false, 1],
      [2, false, 2],
    ]);
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
    expect(
      detectScanned(
        Array.from({ length: 10 }, () => ""),
        [{ page: 1, label: "1", text: "x" }],
        imagePerPage(10),
      ),
    ).toBe(false);
  });
});
