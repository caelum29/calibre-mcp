// extractPdfRaster ordinal mapping (#422): a caption demoted to page-render keeps the handle of
// the fragment it consumed, so an uncaptioned sibling on the same page still maps to its own
// pdfimages row. The poppler runner is faked at the subprocess boundary.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractPdfRaster, type Runner } from "../../src/calibre/figure-fetch.js";
import { buildInventory, parsePdfImagesList } from "../../src/domain/figures/inventory.js";

const row = (page: number, num: number, w: number, h: number) =>
  `  ${page}  ${num} image  ${w}  ${h}  icc  3  8  jpeg  no  ${7000 + num}  0  300  300  1K  5%`;
const header = "page num type width height\n----\n";
// whole-book list (global nums) vs the single-page list fetch runs (nums restart at 0)
const BOOK_LIST = header + [row(2, 40, 109, 11), row(2, 41, 22, 516), row(2, 42, 200, 516)].join("\n");
const PAGE_LIST = header + [row(2, 0, 109, 11), row(2, 1, 22, 516), row(2, 2, 200, 516)].join("\n");

let scratch = "";
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

/** Fake poppler: `-list` prints the page list, `-png` writes one file per row. */
function fakeRunner(dir: string): Runner {
  return async (_bin, args) => {
    if (args.includes("-list")) return PAGE_LIST;
    const root = args[args.length - 1] as string;
    for (let i = 0; i < 3; i++) writeFileSync(`${root}-${String(i).padStart(3, "0")}.png`, "");
    return dir;
  };
}

describe("extractPdfRaster after a demoted caption (#422)", () => {
  it("should_map_uncaptioned_sibling_to_its_own_row_when_caption_was_demoted", async () => {
    scratch = mkdtempSync(path.join(tmpdir(), "fig-fetch-"));
    const inventory = buildInventory(["", "Fig. 2. A composite figure."].join("\f"), parsePdfImagesList(BOOK_LIST));
    const sibling = inventory.entries.find((e) => e.pdfImageNum === 42);

    const file = await extractPdfRaster(fakeRunner(scratch), "pdfimages", "book.pdf", scratch, sibling!, inventory);

    expect(path.basename(file)).toBe("px-002.png");
  });
});
