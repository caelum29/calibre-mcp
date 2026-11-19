// #655 review: the text is cleaned before markers, but inventory captions come raw from the book.
// Caption matching must compare both sides under the same character rules (and survive the
// hyphen join), or a figure that matched before the stage goes unplaced.
import { describe, expect, it } from "vitest";
import type { FigureInventory } from "../../../src/domain/figures/inventory.js";
import { injectFigureMarkers } from "../../../src/domain/figures/markers.js";

const inv = (label: string, caption: string): FigureInventory => ({
  entries: [{ index: 0, page: 1, captioned: true, label, caption, source: "raster" }],
  pageCount: 1,
  scanned: false,
  counts: { figures: 1, uncaptioned: 0, pageRender: 0 },
});

/** Inject one figure into cleaned EPUB text; the marker must sit right before `line`. */
function placed(text: string, line: string, label: string, caption: string): void {
  const out = injectFigureMarkers(text, inv(label, caption), "epub");
  expect(out.unplaced).toBe(0);
  expect(out.markers).toHaveLength(1);
  expect(out.text.slice(out.markers[0]!.charOffset)).toMatch(/^\[image #0: "[^\n]*"\]\n/);
  expect(out.text.slice(out.text.indexOf("\n", out.markers[0]!.charOffset) + 1)).toMatch(new RegExp(`^${line}`));
}

describe("caption matching against the normalised text (#655)", () => {
  it("places a figure whose inventory caption holds ligatures", () => {
    placed(
      "intro\n\nFigure 1.1: A flow of the first file\n\nmore",
      "Figure 1\\.1: A flow",
      "1.1",
      "A ﬂow of the ﬁrst file",
    );
  });

  it("places a figure whose inventory caption holds a soft hyphen", () => {
    placed(
      "intro\n\nFigure 2.3: A simple pipeline view\n\nmore",
      "Figure 2\\.3: A simple",
      "2.3",
      "A sim­ple pipeline view",
    );
  });

  it("places a figure whose caption line had a compound dash joined at a line end", () => {
    placed(
      "intro\n\nFigure 4.2: The clientserver split of the app\n\nmore",
      "Figure 4\\.2: The clientserver",
      "4.2",
      "The client-server split of the app",
    );
  });

  it("places a figure whose inventory caption holds a word joiner (book 699)", () => {
    placed(
      "text\n\n###### *Figure 9-1. *A biological neuron*4*\n\nmore",
      "###### \\*Figure 9-1",
      "9-1",
      "A biological neuron⁠4",
    );
  });
});
