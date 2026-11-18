// #695 review: a span no chunk overlaps reads as body, and an offset at an end shared by
// nested spans (levels 1..3) belongs to the next span only.

import { describe, expect, it } from "vitest";
import { bookSections, sectionPathAt, type SectionSpan } from "../../../src/domain/structure/sections.js";

const prose = (topic: string, n: number) => `The ${topic} section explains one idea in plain words. `.repeat(n);

describe("bookSections: a span with no overlapping chunk (#695 review)", () => {
  it("gets body, whatever kinds the other chunks carry", () => {
    const text = `Chapter 1: Roots\n${prose("roots", 30)}\nChapter 2: Leaves\n${prose("leaves", 30)}`;
    const two = text.indexOf("Chapter 2");
    // Only chapter 1 is chunked (a keyword-only or truncated book); chapter 2 gets no votes.
    const r = bookSections(text, {}, [{ charStart: 0, charEnd: two }], ["front"]);
    expect(r.sections.map((s) => [s.title, s.matterKind])).toEqual([
      ["Chapter 1: Roots", "front"],
      ["Chapter 2: Leaves", "body"],
    ]);
  });
});

describe("sectionPathAt at a shared end, levels 1..3 (#695 review)", () => {
  const span = (title: string, level: number, [charStart, charEnd]: [number, number], parent: number | null) =>
    ({ title, level, charStart, charEnd, parent, matterKind: "body" }) satisfies SectionSpan;
  // Part [0,300) > Chapter [100,300) > Section [200,300) all end at 300, where Next starts.
  const NESTED = [
    span("Part", 1, [0, 300], null),
    span("Chapter", 2, [100, 300], 0),
    span("Section", 3, [200, 300], 1),
    span("Next", 1, [300, 400], null),
  ];
  const path = (offset: number) => sectionPathAt(NESTED, offset).map((s) => s.title);

  it("one char before the shared end is in all three spans", () => {
    expect(path(299)).toEqual(["Part", "Chapter", "Section"]);
  });

  it("the shared end itself is only in the next span", () => {
    expect(path(300)).toEqual(["Next"]);
  });
});
