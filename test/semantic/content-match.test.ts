// textMatchesChunks (#244): the stored chunks are the content fingerprint — any change to the
// covered text, or new non-whitespace text outside it, must read as "changed".

import { describe, expect, it } from "vitest";
import { chunkForEmbedding } from "../../src/semantic/chunk.js";
import { textMatchesChunks } from "../../src/semantic/content-match.js";

const TEXT = "Alpha beta gamma. Delta epsilon zeta. Eta theta iota. ".repeat(80);
const spans = chunkForEmbedding(TEXT, { budget: 300, overlap: 40 });

describe("textMatchesChunks", () => {
  it("matches the exact text the chunks were cut from (overlapping windows)", () => {
    expect(spans.length).toBeGreaterThan(3);
    expect(textMatchesChunks(TEXT, spans)).toBe(true);
  });

  it("tolerates trailing whitespace — the chunker drops whitespace-only windows", () => {
    expect(textMatchesChunks(TEXT + "\n\n   ", spans)).toBe(true);
  });

  it("rejects a one-character edit inside a chunk", () => {
    const i = spans[2]!.charStart + 5;
    expect(textMatchesChunks(TEXT.slice(0, i) + "X" + TEXT.slice(i + 1), spans)).toBe(false);
  });

  it("rejects appended text, a truncated text and an inserted prefix", () => {
    expect(textMatchesChunks(TEXT + "Appendix.", spans)).toBe(false);
    expect(textMatchesChunks(TEXT.slice(0, -10), spans)).toBe(false);
    expect(textMatchesChunks("Preface. " + TEXT, spans)).toBe(false);
  });

  it("rejects text in a gap between non-adjacent spans", () => {
    const gapped = [
      { charStart: 0, charEnd: 5, body: "Alpha" },
      { charStart: 11, charEnd: 17, body: "gamma." },
    ];
    expect(textMatchesChunks("Alpha      gamma.", gapped)).toBe(true);
    expect(textMatchesChunks("Alpha beta gamma.", gapped)).toBe(false);
  });

  it("never matches when nothing is stored", () => {
    expect(textMatchesChunks("", [])).toBe(false);
    expect(textMatchesChunks(TEXT, [])).toBe(false);
  });
});
