// Caption-line detection tests — fixture lines lifted from the 2026-07-22 library probe
// (Software Architecture Metrics, System Programming in Linux, Nikolskiy, Lesovsky) and the
// #107 real-page quirk fixtures.

import { describe, expect, it } from "vitest";
import {
  matchCaptionElement,
  matchCaptionLine,
  scanCaptions,
  splitPages,
} from "../../../src/domain/figures/captions.js";
import * as quirks from "./fixtures/caption-quirks-107.js";

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
    const text = ["intro page", "prose\nFigure 1-1. First\nMore prose.", "Figure 1-2: Second"].join("\f");
    expect(scanCaptions(text)).toEqual([
      { page: 2, label: "1-1", text: "First" },
      { page: 3, label: "1-2", text: "Second" },
    ]);
  });

  it("splitPages keeps empty pages so numbering stays aligned", () => {
    expect(splitPages("a\f\fb")).toEqual(["a", "", "b"]);
  });
});

describe("wrapped in-text references (#116)", () => {
  const wrappedRef = "Figure 2.10. This instruction pipeline is identified as the TYP pipeline";
  const runOn = "types resulted in the six-stage instruction pipeline shown in the right-hand side of";

  it("rejects a caption-shaped line whose previous line's sentence runs on", () => {
    expect(matchCaptionLine(wrappedRef, runOn)).toBeNull();
  });

  it("rejects when the previous line breaks on a hyphenation mark", () => {
    expect(matchCaptionLine(wrappedRef, "the four sequences of subcomputations required by these instruc¬")).toBeNull();
  });

  it("keeps captions after a blank line or terminal punctuation", () => {
    expect(matchCaptionLine(wrappedRef, "")?.label).toBe("2.10");
    expect(
      matchCaptionLine(wrappedRef, "…required to support them. This procedure results in a definition.")?.label,
    ).toBe("2.10");
  });

  it("keeps captions after a short diagram inner label (RU false-rejection case)", () => {
    expect(matchCaptionLine("Рис. 2.3. Джейн Доу представлена двумя сущностями", "спортсмен")?.label).toBe("2.3");
  });

  it("scanCaptions applies the guard with real page context", () => {
    const page = [runOn, wrappedRef, "", "Figure 2.11. The physical organization of the pipeline"].join("\n");
    expect(scanCaptions(page)).toEqual([{ page: 1, label: "2.11", text: "The physical organization of the pipeline" }]);
  });

  it("does not apply the guard when no context is supplied (EPUB blocks)", () => {
    expect(matchCaptionLine(wrappedRef)?.label).toBe("2.10");
  });
});

describe("Manning double-space captions (probe #77)", () => {
  it("keeps the dotted label whole when a wide gap separates it from the text", () => {
    expect(matchCaptionLine("Figure 4.1  The producer sends records to the broker")).toEqual({
      label: "4.1",
      text: "The producer sends records to the broker",
    });
  });

  it("still rejects single-space in-text references (Manning mis-parse case)", () => {
    expect(matchCaptionLine("Figure 2.12 displays the flow between components")).toBeNull();
  });

  it("rejects a wide gap followed by lowercase (reference shape, not a caption)", () => {
    expect(matchCaptionLine("Figure 2.12  displays the flow between components")).toBeNull();
  });
});

describe("matchCaptionElement", () => {
  it("should accept the separator-less form", () => {
    expect(matchCaptionElement("Figure 4.1 Standard RL loop")).toEqual({ label: "4.1", text: "Standard RL loop" });
  });

  it("should reject a block over 300 chars", () => {
    expect(matchCaptionElement(`Figure 1.1 ${"x".repeat(300)}`)).toBeNull();
  });
});

describe("caption quirks on real pages (#107)", () => {
  // Every fixture is a real pdftotext snippet; see fixtures/caption-quirks-107.md.
  for (const [name, fixture] of Object.entries(quirks)) {
    it(`should_scan_${name}_like_${fixture.source.replace(/\W+/g, "_")}`, () => {
      const found = scanCaptions(fixture.page).map(({ label, text }) => ({ label, text }));
      expect(found).toEqual(fixture.expected);
    });
  }
});

describe("caption continuation (#107)", () => {
  it("should_stop_joining_at_an_unpunctuated_caption_followed_by_a_capitalized_paragraph", () => {
    expect(scanCaptions("Figure 1-1. The fundamental mental model\nThe next paragraph starts here.")[0]?.text).toBe(
      "The fundamental mental model",
    );
  });

  it("should_mark_a_caption_cut_on_a_dangling_word_with_an_ellipsis", () => {
    const page = [
      "Figure 1-5: Execution in kernel and user mode. The CPU executes",
      "code in a",
      "loop and the",
      "next one and the",
      "last one.",
    ].join("\n");
    expect(scanCaptions(page)[0]?.text.endsWith("the…")).toBe(true);
  });

  it("should_join_a_RU_word_break_without_the_hyphen", () => {
    expect(scanCaptions("Рис. 10.9. Схема редукто-\nров и регионов")[0]?.text).toBe("Схема редукторов и регионов");
  });

  it("should_keep_an_EN_compound_dash_when_joining", () => {
    expect(scanCaptions("Figure 3-1: A kernel-\nlevel view of the scheduler.")[0]?.text).toBe(
      "A kernel-level view of the scheduler.",
    );
  });

  it("should_reject_a_period_ended_label_whose_sentence_ran_on_past_a_blank_line", () => {
    const page = ["The layout of the virtual address space is indicated by an arrow in", "", "Figure 3-34.", ""].join(
      "\n",
    );
    expect(scanCaptions(page)).toEqual([]);
  });

  it("should_strip_a_private_use_separator_glyph", () => {
    expect(matchCaptionLine("Рис. 1.1 \uf076 Территориально распределенные центры")?.text).toBe(
      "Территориально распределенные центры",
    );
  });

  it("should_reject_caption_text_opening_on_closing_punctuation", () => {
    expect(matchCaptionLine("рис. 11.10) или, в случае HDFS, может")).toBeNull();
  });
});

describe("stray label-only heads (#107)", () => {
  it("should_drop_a_label_only_head_whose_label_has_a_real_caption_elsewhere", () => {
    const text = ["Рис. 7.2", "", "prose"].join("\n") + "\f" + "Рис. 7.2. Схема ветвления";
    expect(scanCaptions(text)).toEqual([{ page: 2, label: "7.2", text: "Схема ветвления" }]);
  });

  it("should_drop_label_only_heads_on_a_list_of_figures_page", () => {
    // back-of-book index of The TCP/IP Guide (book 1111): topic / label / page number
    const page = [
      "ARP message format",
      "",
      "Figure 13-6",
      "",
      "218",
      "",
      "ARP Proxy operation",
      "",
      "Figure 13-7",
      "",
      "222",
      "",
      "Figure 30-9",
      "",
      "Figure 13-1",
      "",
    ].join("\n");
    expect(scanCaptions(page)).toEqual([]);
  });

  it("should_keep_a_label_only_figure_without_a_captioned_twin", () => {
    expect(scanCaptions(["HEAD", "", "Figure 1.2", "", "TV 2 consumer"].join("\n"))).toEqual([
      { page: 1, label: "1.2", text: "" },
    ]);
  });
});

describe("block captions under a bare label (#107)", () => {
  it.each([
    ["a page number", "23"],
    ["a back-of-book index entry", "Ручное тестирование 371,385,510"],
    ["an image id", "F03MQ02"],
    ["a sidebar admonition", "ПРИМЕЧАНИЕ Метод Object.getOwnPropertyDescriptor() работает"],
    ["a lone word", "Models”)"],
  ])("should_not_take_%s_as_caption_text", (_kind, line) => {
    expect(scanCaptions(["Figure 2.3", line, ""].join("\n"))[0]?.text).toBe("");
  });

  it("should_not_join_prose_after_a_short_title_line", () => {
    const page = [
      "Figure 8-1",
      "The methods of Map",
      "If our application needs a Map of Sensors, you might find them here",
      "Map<String, Sensor> sensors;",
    ].join("\n");
    expect(scanCaptions(page)[0]?.text).toBe("");
  });

  it("should_keep_label_only_when_body_prose_follows_the_label", () => {
    // book 947 p.71: the label sits under the diagram, the paragraph resumes right after
    const page = [
      "Vice President",
      "",
      "Figure 2-3",
      "You can even think of the information in this book as a tree",
      "paragraphs and sections; sections contain paragraphs",
      "which contain words, which contain characters.)",
      "More text follows here.",
    ].join("\n");
    expect(scanCaptions(page)).toEqual([{ page: 1, label: "2-3", text: "" }]);
  });

  it("should_not_take_a_figure_reference_as_the_caption_text", () => {
    const page = [
      "Accounting",
      "",
      "Figure 2-2",
      "Figure 2-3 shows the same information in a slightly different way",
      "vertically in a way similar to that used by Windows",
      "In a pipe system",
    ].join("\n");
    expect(scanCaptions(page)[0]).toEqual({ page: 1, label: "2-2", text: "" });
  });
});
