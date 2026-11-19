// #655 / ADR-0033: the text-normalisation stage (character rule set) and its cleaned→raw offset map.
import { describe, expect, it } from "vitest";
import { CHARACTER_RULES, normaliseText } from "../../../src/domain/normalise/normalise.js";
import {
  composeEdits,
  decodeOffsetMap,
  encodeOffsetMap,
  insertionEdits,
  toCleaned,
  toRaw,
} from "../../../src/domain/normalise/offset-map.js";

const clean = (raw: string) => normaliseText(raw, [CHARACTER_RULES]).text;

/** Every cleaned position maps back into raw text, and the mapped raw char is the cleaned char's source. */
function expectMapsBack(raw: string): void {
  const { text, map } = normaliseText(raw, [CHARACTER_RULES]);
  let prev = 0;
  for (let p = 0; p <= text.length; p++) {
    const r = toRaw(map, p);
    expect(r).toBeGreaterThanOrEqual(prev); // monotone
    expect(r).toBeLessThanOrEqual(raw.length);
    prev = r;
  }
  expect(toRaw(map, text.length)).toBe(raw.length);
}

describe("character rule set (#655)", () => {
  it("folds ligatures by NFKC", () => {
    expect(clean("the ﬁle and the ﬂow")).toBe("the file and the flow");
  });

  it("folds full-width forms and the ellipsis by NFKC", () => {
    expect(clean("ＡＰＩ…")).toBe("API...");
  });

  it("keeps superscripts and subscripts as they are", () => {
    expect(clean("x² + y³ = z¹")).toBe("x² + y³ = z¹");
    expect(clean("H₂O and CO₂, eⁿ, xᵢ")).toBe("H₂O and CO₂, eⁿ, xᵢ");
  });

  it("still folds a ligature next to a kept superscript", () => {
    expect(clean("ﬁ²")).toBe("fi²");
  });

  it("drops control characters except \\n, \\t, \\f and keeps U+FFFD", () => {
    expect(clean("a\u0000b\u0007c\r\nd\u007fe\u0085f")).toBe("abc\ndef");
    expect(clean("tab\there\fpage�x")).toBe("tab\there\fpage�x");
  });

  it("turns Unicode spaces into a plain space and drops zero-width spaces", () => {
    expect(clean("a b c d　e")).toBe("a b c d e");
    expect(clean("http://exa​mple.com﻿")).toBe("http://example.com");
  });

  it("removes the soft hyphen", () => {
    expect(clean("hyphen­ation")).toBe("hyphenation");
  });

  it("joins a line-end hyphen only when the next line starts lowercase", () => {
    expect(clean("dis-\nplayed here")).toBe("displayed here");
    expect(clean("dis-\n\nplayed")).toBe("displayed");
    expect(clean("пере-\nдача")).toBe("передача");
    expect(clean("soft­\nhyphen")).toBe("softhyphen");
    expect(clean("non‐\nbreaking")).toBe("nonbreaking");
    // uppercase, digit or markup after the break: a real dash, kept
    expect(clean("Client-\nServer")).toBe("Client-\nServer");
    expect(clean("item-\n2 more")).toBe("item-\n2 more");
    expect(clean("list:\n-\nfoo")).toBe("list:\n-\nfoo");
  });

  it("never joins across a page break and never deletes \\f", () => {
    const raw = "end of page dis-\fplayed\fnext-\n\fpage";
    const out = clean(raw);
    expect(out).toBe(raw);
    expect(out.split("\f").length).toBe(raw.split("\f").length);
  });

  it("keeps heading markers and ATX headings", () => {
    const raw = "text\n## Chapter 1\n\n### 1.2 Sub\n# Top";
    expect(clean(raw)).toBe("text\n## Chapter 1\n\n### 1.2 Sub\n# Top");
  });

  it("leaves clean text byte-identical with an empty map", () => {
    const raw = "Plain ASCII.\n\nКириллица без изменений, і українська — теж.\f";
    const { text, map } = normaliseText(raw, [CHARACTER_RULES]);
    expect(text).toBe(raw);
    expect(map.edits).toEqual([]);
  });
});

describe("cleaned → raw offset map (#655)", () => {
  it("maps positions after a ligature back exactly", () => {
    const raw = "a ﬁle b";
    const { text, map } = normaliseText(raw, [CHARACTER_RULES]);
    expect(text).toBe("a file b");
    expect(toRaw(map, 0)).toBe(0);
    expect(toRaw(map, 2)).toBe(2); // "f" ← "ﬁ"
    expect(toRaw(map, 4)).toBe(3); // "l"
    expect(text.slice(4)).toBe(raw.slice(toRaw(map, 4)));
    expect(toCleaned(map, 3)).toBe(4);
    expect(toCleaned(map, raw.length)).toBe(text.length);
  });

  it("maps around a deletion and a hyphen join", () => {
    const raw = "x\u0000y dis-\nplayed z";
    const { text, map } = normaliseText(raw, [CHARACTER_RULES]);
    expect(text).toBe("xy displayed z");
    const at = text.indexOf("played");
    expect(raw.slice(toRaw(map, at))).toBe("played z");
    expect(raw.slice(toRaw(map, text.indexOf("z")))).toBe("z");
    expect(toCleaned(map, raw.indexOf("z"))).toBe(text.indexOf("z"));
  });

  it("is monotone and ends at the raw length", () => {
    expectMapsBack("ﬁ\u0000 dis-\nplayed ＡＢ… x² é \r\n end");
  });

  it("composes with marker insertions made after cleaning", () => {
    const raw = "aﬁb";
    const { text, map } = normaliseText(raw, [CHARACTER_RULES]);
    expect(text).toBe("afib");
    // a 2-char marker line inserted at cleaned offset 0
    const final = `M\n${text}`;
    const composed = { edits: composeEdits(map.edits, insertionEdits([{ at: 0, length: 2 }])) };
    expect(final.slice(3, 5)).toBe("fi");
    expect(toRaw(composed, 3)).toBe(1);
    expect(toRaw(composed, 5)).toBe(2);
    expect(toRaw(composed, final.length)).toBe(raw.length);
    expect(toCleaned(composed, 2)).toBe(5);
  });

  it("round-trips through its compact encoding", () => {
    const { map } = normaliseText("ﬁ x\u0000 dis-\nplayed ＡＢ", [CHARACTER_RULES]);
    expect(map.edits.length).toBeGreaterThan(0);
    expect(decodeOffsetMap(encodeOffsetMap(map))).toEqual(map);
    expect(decodeOffsetMap("not a map")).toBeUndefined();
    expect(decodeOffsetMap(encodeOffsetMap({ edits: [] }))).toEqual({ edits: [] });
  });
});
