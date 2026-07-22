// Caption-line detection tests — fixture lines lifted from the 2026-07-22 library probe
// (Software Architecture Metrics, System Programming in Linux, Nikolskiy, Lesovsky).

import { describe, expect, it } from "vitest";
import { matchCaptionLine, scanCaptions, splitPages } from "../../../src/domain/figures/captions.js";

describe("matchCaptionLine", () => {
  it("matches O'Reilly dot captions", () => {
    expect(matchCaptionLine("Figure 1-1. The fundamental mental model behind the four key metrics")).toEqual({
      label: "1-1",
      text: "The fundamental mental model behind the four key metrics",
    });
  });

  it("matches No Starch colon captions", () => {
    expect(matchCaptionLine("Figure 1-2: An operating system has layers to protect resources.")).toEqual({
      label: "1-2",
      text: "An operating system has layers to protect resources.",
    });
  });

  it("matches dotted numbering and Fig. abbreviation", () => {
    expect(matchCaptionLine("Figure 2.4. Consumer group rebalancing")?.label).toBe("2.4");
    expect(matchCaptionLine("Fig. 3: Payload layout")?.label).toBe("3");
  });

  it("matches RU captions, including the no-space Nikolskiy style", () => {
    expect(matchCaptionLine("Рис. 15.7. Схема обработки событий")).toEqual({
      label: "15.7",
      text: "Схема обработки событий",
    });
    expect(matchCaptionLine("рис.15.7")?.label).toBe("15.7");
    expect(matchCaptionLine("Рисунок 3. Архитектура")?.label).toBe("3");
  });

  it("tolerates the pdftotext form feed before a page-first caption", () => {
    expect(matchCaptionLine("\fFigure 1-1: The execution flow of input operation")?.label).toBe("1-1");
  });

  it("rejects in-text references (no separator after the number)", () => {
    expect(matchCaptionLine("terminal. Figure 1-1 illustrates how this happens.")).toBeNull();
    expect(matchCaptionLine("Figure 1-2 shows the layers involved.")).toBeNull();
  });

  it("rejects Table and Listing captions (they label text, not rasters)", () => {
    expect(matchCaptionLine("Table 2-1. Metric definitions")).toBeNull();
    expect(matchCaptionLine("Listing 3-2. A recursive descent parser")).toBeNull();
  });

  it("rejects mid-sentence lines that merely start with Figure", () => {
    const wrapped = `Figure 1. ${"x".repeat(300)}`;
    expect(matchCaptionLine(wrapped)).toBeNull();
  });
});

describe("scanCaptions", () => {
  it("assigns 1-based pages from form-feed breaks, in document order", () => {
    const text = ["intro page", "prose\nFigure 1-1. First\nmore prose", "Figure 1-2: Second"].join("\f");
    expect(scanCaptions(text)).toEqual([
      { page: 2, label: "1-1", text: "First" },
      { page: 3, label: "1-2", text: "Second" },
    ]);
  });

  it("splitPages keeps empty pages so numbering stays aligned", () => {
    expect(splitPages("a\f\fb")).toEqual(["a", "", "b"]);
  });
});
