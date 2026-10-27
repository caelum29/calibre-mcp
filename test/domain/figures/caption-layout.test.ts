// Layout caption recovery tests (#107 follow-up). Fixtures in ./fixtures/layout are real
// `pdftotext -bbox-layout` pages from the Programming Books library, cut to the blocks
// around the label (coordinates rounded to 0.1 pt); the file name is `<book>-p<page>`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  labelOnlyPages,
  type LayoutPage,
  parseBboxLayout,
  recoverCaptionText,
  recoverLabelOnlyCaptions,
} from "../../../src/domain/figures/caption-layout.js";
import { buildInventory } from "../../../src/domain/figures/inventory.js";
import { injectFigureMarkers } from "../../../src/domain/figures/markers.js";

function fixturePage(name: string): LayoutPage {
  const html = readFileSync(new URL(`./fixtures/layout/${name}.html`, import.meta.url), "utf8");
  const page = parseBboxLayout(html, new Set([1])).get(1);
  if (!page) throw new Error(`no page in ${name}`);
  return page;
}

describe("recoverCaptionText — caption on the label's baseline", () => {
  it("should_read_the_text_beside_a_manning_label_not_the_diagram_labels_above_it", () => {
    // book 182 p.30: "TV 2 consumer" is the line under "Figure 1.2" in the text stream
    expect(recoverCaptionText(fixturePage("182-p30"), "1.2")).toBe("Kafka’s flow from producers to consumers");
  });

  it("should_read_each_of_two_labels_on_a_pearson_page", () => {
    // book 74 p.28: the text stream puts the caption after a blank line
    const page = fixturePage("74-p28");
    expect(recoverCaptionText(page, "1.3")).toBe("Object-to-object communication.");
    expect(recoverCaptionText(page, "1.4")).toBe("Data transmitted over a wire.");
  });

  it("should_join_a_centered_wrap_under_the_caption_line", () => {
    // book 1234 p.59: the second line is centered under the first, not left-aligned
    expect(recoverCaptionText(fixturePage("1234-p59"), "4.1")).toBe(
      "A broad-brush architecture diagram drawn on the wall of a team’s work area",
    );
  });

  it("should_join_a_hanging_wrap_flush_with_the_label", () => {
    // book 938 p.145: the caption's second line returns to the label's left edge
    expect(recoverCaptionText(fixturePage("938-p145"), "4.3")).toMatch(
      /^Making Battery Orientation Irrelevant\. This photograph shows a battery whose orientation/u,
    );
  });

  it("should_accept_a_one_word_caption_beside_the_label", () => {
    expect(recoverCaptionText(fixturePage("182-p139"), "6.1")).toBe("Brokers");
  });
});

describe("recoverCaptionText — caption in the label's block", () => {
  it("should_read_a_narrow_side_column_caption_below_the_label", () => {
    // book 403 p.102: one or two words per line beside the figure
    expect(recoverCaptionText(fixturePage("403-p102"), "3.6")).toBe("Illustration of gossip communication");
  });

  it("should_read_a_flush_right_column_and_keep_a_compound_hyphen", () => {
    // book 836 p.25 (Wiley): the column hangs left of the label, flush with its right edge
    expect(recoverCaptionText(fixturePage("836-p25"), "1-1")).toBe("A ChatGPT-generated HTML template.");
  });

  it("should_read_a_full_width_caption_block_under_the_label", () => {
    // book 1231 p.42: one wide sentence in a block of its own, body text after it
    expect(recoverCaptionText(fixturePage("1231-p42"), "1.3")).toBe(
      "The software design process and design activities during the SWE process.",
    );
  });

  it("should_not_read_a_caption_for_a_reference_inside_another_caption", () => {
    // book 371 p.201: "…relationship in / Figure 3-5." ends Figure 3-6's caption
    const page = fixturePage("371-p201");
    expect(recoverCaptionText(page, "3-6")).toBe(
      "A relational model representation of the one-to-many relationship in Figure 3-5.",
    );
    expect(recoverCaptionText(page, "3-5")).toBeNull();
  });

  it("should_fall_back_to_the_block_when_the_baseline_neighbour_is_not_caption_text", () => {
    // book 110 p.386: diagram text shares the label's baseline; the caption is the block below
    expect(recoverCaptionText(fixturePage("110-p386"), "11.9")).toBe(
      "Applying automated Kubernetes health checks to the metadata microservice",
    );
  });

  it("should_leave_a_caption_that_opens_on_another_figure_label", () => {
    // book 403 p.250: "Figure 9.12 with two priority levels" — not this figure's text alone
    expect(recoverCaptionText(fixturePage("403-p250"), "9.13")).toBeNull();
  });
});

describe("recoverCaptionText — anchors", () => {
  it("should_return_null_when_the_label_is_not_on_the_page", () => {
    expect(recoverCaptionText(fixturePage("182-p30"), "1.9")).toBeNull();
  });
});

describe("parseBboxLayout", () => {
  it("should_number_pages_from_the_run_start_and_keep_only_wanted_ones", () => {
    const one = readFileSync(new URL("./fixtures/layout/182-p139.html", import.meta.url), "utf8");
    const pages = parseBboxLayout(`${one}\n${one}\n${one}`, new Set([41]), 40);
    expect([...pages.keys()]).toEqual([41]);
    expect(pages.get(41)?.lines.map((l) => l.text)).toContain("Figure 6.1");
  });
});

describe("recoverLabelOnlyCaptions", () => {
  it("should_fill_only_label_only_captions_on_pages_with_layout", () => {
    const layout = new Map([[30, fixturePage("182-p30")]]);
    const out = recoverLabelOnlyCaptions(
      [
        { page: 30, label: "1.2", text: "" },
        { page: 30, label: "1.1", text: "Producers, receivers, and data flow overview" },
        { page: 31, label: "1.3", text: "" },
      ],
      layout,
    );
    expect(out.map((c) => c.text)).toEqual([
      "Kafka’s flow from producers to consumers",
      "Producers, receivers, and data flow overview",
      "",
    ]);
    expect(labelOnlyPages(out)).toEqual([31]);
  });
});

describe("layout captions end to end", () => {
  // book 182 p.30 as the text stream gives it: diagram labels between label and caption
  const text = [
    "TV 1 consumer",
    "",
    "Figure 1.2",
    "",
    "TV 2 consumer",
    "",
    "Stereo consumer",
    "",
    "Kafka’s flow from producers to consumers",
  ].join("\n");

  it("should_caption_the_figure_and_keep_its_index", () => {
    const layout = new Map([[1, fixturePage("182-p30")]]);
    const plain = buildInventory(text, []);
    const inv = buildInventory(text, [], layout);
    expect(plain.entries[0]).toMatchObject({ index: 0, label: "1.2", caption: "" });
    expect(inv.entries[0]).toMatchObject({
      index: 0,
      label: "1.2",
      caption: "Kafka’s flow from producers to consumers",
    });
  });

  it("should_place_the_marker_when_the_label_opens_its_page", () => {
    // book 836 p.28: "\fFIGURE 1-3:" — the line starts on the page's form feed
    const book = `Intro page\n\f${text.replace(/^TV 1 consumer\n\n/u, "")}`;
    const marked = injectFigureMarkers(book, buildInventory(book, [], new Map([[2, fixturePage("182-p30")]])), "pdf");
    expect(marked.markers[0]!.caption).toBe("Figure 1.2 Kafka’s flow from producers to consumers");
  });

  it("should_place_the_marker_on_the_label_line_not_the_page_boundary", () => {
    const inv = buildInventory(text, [], new Map([[1, fixturePage("182-p30")]]));
    const marked = injectFigureMarkers(
      `Intro page\f${text}`,
      { ...inv, entries: inv.entries.map((e) => ({ ...e, page: 2 })) },
      "pdf",
    );
    expect(marked.markers).toHaveLength(1);
    expect(marked.markers[0]!.caption).toContain("Kafka’s flow");
    // the label line, not the page start right after the form feed
    expect(marked.text.slice(marked.markers[0]!.charOffset)).toMatch(
      /^\[image #0: page 2, "Figure 1\.2 Kafka’s flow from producers to consumers"\]\nFigure 1\.2\n/u,
    );
  });
});
