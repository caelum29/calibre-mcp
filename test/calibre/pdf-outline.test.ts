import { describe, it, expect } from "vitest";
import { pdftohtmlOutlineArgs, readPdfOutline } from "../../src/calibre/pdf-outline.js";

describe("pdftohtml outline runner", () => {
  it("converts only page 1 to XML on stdout, without images", () => {
    expect(pdftohtmlOutlineArgs("/b.pdf")).toEqual(["-q", "-i", "-xml", "-stdout", "-f", "1", "-l", "1", "/b.pdf"]);
  });

  it("degrades to [] when the binary is missing", async () => {
    expect(await readPdfOutline("/nonexistent/pdftohtml", "/b.pdf")).toEqual([]);
  });

  it("degrades to [] when the tool prints no outline", async () => {
    // `true` ignores its args and prints nothing — an outline-less run.
    expect(await readPdfOutline("/usr/bin/true", "/b.pdf")).toEqual([]);
  });
});
