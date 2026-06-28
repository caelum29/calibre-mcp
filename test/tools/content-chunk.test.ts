import { describe, it, expect } from "vitest";
import { chunkText } from "../../src/tools/content-chunk.js";

describe("chunkText", () => {
  it("returns the whole text and no more when it fits in one window", () => {
    const r = chunkText("hello world", { offset: 0, maxChars: 100, sentenceAware: false });
    expect(r.slice).toBe("hello world");
    expect(r.hasMore).toBe(false);
    expect(r.end).toBe(11);
  });

  it("pages by raw offset when sentenceAware is off", () => {
    const text = "abcdefghij"; // 10 chars
    const r = chunkText(text, { offset: 0, maxChars: 4, sentenceAware: false });
    expect(r.slice).toBe("abcd");
    expect(r.end).toBe(4);
    expect(r.hasMore).toBe(true);
  });

  it("trims to the last sentence boundary above the half-maxChars floor", () => {
    // maxChars=16 → floor=8; the "." at index 11 is above the floor, so we cut there.
    const text = "Lorem ipsum. Dolor sit amet.";
    const r = chunkText(text, { offset: 0, maxChars: 16, sentenceAware: true });
    expect(r.slice).toBe("Lorem ipsum.");
    expect(r.end).toBe(12);
    expect(r.hasMore).toBe(true);
  });

  it("never trims below half of maxChars (avoids tiny chunks)", () => {
    // The only boundary is at index 1 ("A."), well below the 50% floor of maxChars=20,
    // so the full window is kept instead.
    const text = "A. bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const r = chunkText(text, { offset: 0, maxChars: 20, sentenceAware: true });
    expect(r.slice.length).toBe(20);
  });

  it("returns an empty slice when offset is at or past the end", () => {
    const r = chunkText("abc", { offset: 3, maxChars: 10, sentenceAware: true });
    expect(r.slice).toBe("");
    expect(r.hasMore).toBe(false);
  });

  it("does not split a surrogate pair at the cut point", () => {
    // "😀" is two UTF-16 code units; a maxChars=3 cut lands mid-pair on the second emoji.
    const text = "😀😀"; // 4 code units
    const r = chunkText(text, { offset: 0, maxChars: 3, sentenceAware: false });
    expect(r.slice).toBe("😀"); // dropped the dangling high surrogate
    expect(r.end).toBe(2);
  });
});
