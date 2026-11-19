// #655 / ADR-0033: a marker line is part of the indexed text, so caption text it takes from the figure
// inventory (PDF page-fallback and layout-read captions) gets the same character rules as the text.
import { describe, expect, it } from "vitest";
import type { FigureInventory } from "../../../src/domain/figures/inventory.js";
import { injectFigureMarkers } from "../../../src/domain/figures/markers.js";

const inventory = (caption: string): FigureInventory => ({
  entries: [{ index: 0, page: 2, captioned: true, label: "4.5", caption, source: "raster" }],
  pageCount: 2,
  scanned: false,
  counts: { figures: 1, uncaptioned: 0, pageRender: 0 },
});

describe("marker captions from the inventory (#655)", () => {
  it("cleans a page-fallback caption with the character rules", () => {
    const out = injectFigureMarkers(
      "page one\fpage two\n",
      inventory(
        "\u041f\u043b\u0430\u043d \u043b\u0438\u0441\u00ad\u0442\u0438\u043d\u0433\u0430 \ufb01le\u00a0x\u00b2",
      ),
      "pdf",
    );
    expect(out.text).toBe(
      'page one\f[image #0: page 2, "4.5. \u041f\u043b\u0430\u043d \u043b\u0438\u0441\u0442\u0438\u043d\u0433\u0430 file x\u00b2"]\npage two\n',
    );
    expect(out.markers[0]!.caption).toBe(
      "4.5. \u041f\u043b\u0430\u043d \u043b\u0438\u0441\u0442\u0438\u043d\u0433\u0430 file x\u00b2",
    );
    expect(out.insertions).toEqual([{ at: 9, length: out.text.indexOf("\n", 9) - 9 + 1 }]);
  });

  it("leaves a clean caption as it was", () => {
    const out = injectFigureMarkers("page one\fpage two\n", inventory("Plain caption"), "pdf");
    expect(out.markers[0]!.caption).toBe("4.5. Plain caption");
  });
});
