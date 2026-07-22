import { describe, it, expect } from "vitest";
import { formatMarker, injectFigureMarkers } from "../../../src/domain/figures/markers.js";
import type { FigureEntry, FigureInventory } from "../../../src/domain/figures/inventory.js";

function inv(entries: Array<Partial<FigureEntry>>): FigureInventory {
  const full = entries.map((e, i) => ({
    index: i,
    page: 1,
    captioned: true,
    source: "raster" as const,
    ...e,
  }));
  const figures = full.filter((e) => e.captioned);
  return {
    entries: full,
    pageCount: 3,
    scanned: false,
    counts: {
      figures: figures.length,
      uncaptioned: full.length - figures.length,
      pageRender: 0,
    },
  };
}

describe("formatMarker", () => {
  it("includes the page for pdf", () => {
    expect(formatMarker(12, 47, "Figure 2.1 — Event flow", "pdf")).toBe(
      '[image #12: page 47, "Figure 2.1 — Event flow"]',
    );
  });
  it("omits the page for epub (spine ordinals mean nothing to a reader)", () => {
    expect(formatMarker(3, 2, "Figure 2.1 — Event flow", "epub")).toBe('[image #3: "Figure 2.1 — Event flow"]');
  });
  it("truncates a runaway caption", () => {
    const marker = formatMarker(0, 1, "x".repeat(500), "pdf");
    expect(marker.length).toBeLessThan(160);
    expect(marker).toContain("…");
  });
});

describe("injectFigureMarkers — placement", () => {
  const pdfText = "Intro line\ntext before\nFigure 2.1. Event flow through the broker\nmore text\f" + "Second page\n";

  it("places the marker on its own line above the caption line", () => {
    const out = injectFigureMarkers(pdfText, inv([{ label: "2.1", caption: "Event flow through the broker" }]), "pdf");
    expect(out.text).toContain('[image #0: page 1, "Figure 2.1. Event flow through the broker"]\nFigure 2.1.');
  });

  it("reports the marker offset pointing at the marker in the NEW text", () => {
    const out = injectFigureMarkers(pdfText, inv([{ label: "2.1", caption: "Event flow through the broker" }]), "pdf");
    const m = out.markers[0]!;
    expect(out.text.slice(m.charOffset, m.charOffset + 9)).toBe("[image #0");
  });

  it("uses the matched caption line verbatim as the marker caption", () => {
    const out = injectFigureMarkers(pdfText, inv([{ label: "2.1", caption: "Event flow through the broker" }]), "pdf");
    expect(out.markers[0]!.caption).toBe("Figure 2.1. Event flow through the broker");
  });

  it("falls back to the page boundary when the caption is not in the text (pdf)", () => {
    const text = "page one text\fpage two text\nno captions here\n";
    const out = injectFigureMarkers(text, inv([{ label: "9.9", caption: "Missing diagram", page: 2 }]), "pdf");
    expect(out.unplaced).toBe(0);
    const m = out.markers[0]!;
    expect(out.text.slice(m.charOffset - 1, m.charOffset)).toBe("\f");
  });

  it("reports unplaced instead of guessing when nothing matches (epub has no pages)", () => {
    const out = injectFigureMarkers("plain text, no captions", inv([{ label: "1.1", caption: "Ghost figure" }]), "epub");
    expect(out.unplaced).toBe(1);
    expect(out.text).toBe("plain text, no captions");
  });

  it("skips uncaptioned entries entirely", () => {
    const out = injectFigureMarkers(pdfText, inv([{ captioned: false, label: undefined, caption: undefined }]), "pdf");
    expect(out.markers).toHaveLength(0);
    expect(out.text).toBe(pdfText);
  });

  it("matches an emphasis-wrapped markdown caption (ebook-convert epub output)", () => {
    const text = "chapter text\n*Figure 12.1 – Logical architecture of the system*\nmore\n";
    const out = injectFigureMarkers(text, inv([{ label: "12.1", caption: "Logical architecture of the system" }]), "epub");
    expect(out.markers).toHaveLength(1);
    expect(out.text).toContain('[image #0: "Figure 12.1 – Logical architecture of the system"]\n*Figure 12.1');
  });

  it("matches a heading+bold markdown caption (`##### **Figure 1.1** Text`, RLHF epub shape)", () => {
    const text = "prose\n##### **Figure 4.1** Standard RL loop\nmore prose\n";
    const out = injectFigureMarkers(text, inv([{ label: "4.1", caption: "Standard RL loop" }]), "epub");
    expect(out.markers[0]?.caption).toBe("Figure 4.1 Standard RL loop");
  });

  it("matches labels across separator variants (2-1 in inventory vs 2.1 in text)", () => {
    const text = "Figure 2.1. Event flow\n";
    const out = injectFigureMarkers(text, inv([{ label: "2-1", caption: "Event flow" }]), "pdf");
    expect(out.markers).toHaveLength(1);
  });

  it("ignores a bare in-text reference and anchors on the real caption line", () => {
    const text = "Figure 3.4 shows the layout in detail, as discussed.\nsome prose\nFigure 3.4. The broker layout\n";
    const out = injectFigureMarkers(text, inv([{ label: "3.4", caption: "The broker layout" }]), "pdf");
    expect(out.text.indexOf("[image #0")).toBeGreaterThan(out.text.indexOf("some prose"));
  });

  it("keeps document order for duplicate labels (greedy forward matching)", () => {
    const text = "Figure 1.1. First diagram\nmiddle\nFigure 1.1. Second diagram\n";
    const out = injectFigureMarkers(
      text,
      inv([
        { label: "1.1", caption: "First diagram" },
        { label: "1.1", caption: "Second diagram", index: 1 },
      ]),
      "pdf",
    );
    expect(out.markers.map((m) => m.index)).toEqual([0, 1]);
    expect(out.markers[0]!.charOffset).toBeLessThan(out.markers[1]!.charOffset);
  });

  it("two markers shift later offsets correctly", () => {
    const text = "Figure 1.1. Alpha\nfiller\nFigure 1.2. Beta\n";
    const out = injectFigureMarkers(
      text,
      inv([
        { label: "1.1", caption: "Alpha" },
        { label: "1.2", caption: "Beta", index: 1 },
      ]),
      "pdf",
    );
    for (const m of out.markers) {
      expect(out.text.slice(m.charOffset, m.charOffset + 8)).toBe(`[image #`);
    }
    expect(out.text.indexOf("[image #1")).toBe(out.markers[1]!.charOffset);
  });

  it("returns text untouched for an inventory with no captioned figures", () => {
    const out = injectFigureMarkers("hello", inv([]), "pdf");
    expect(out).toEqual({ text: "hello", markers: [], unplaced: 0 });
  });

  it("matches a RU caption line", () => {
    const text = "текст главы\nРис. 15.7. Схема репликации данных\n";
    const out = injectFigureMarkers(text, inv([{ label: "15.7", caption: "Схема репликации данных" }]), "pdf");
    expect(out.markers[0]!.caption).toBe("Рис. 15.7. Схема репликации данных");
  });
});
