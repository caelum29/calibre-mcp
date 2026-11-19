// #655 / ADR-0033 item 7: the chunker's sentence tier breaks at Intl.Segmenter sentence ends, not at
// every ". " (which cut at "e.g." and "Fig. 3"). Char budgets make the break window exact.
import { describe, expect, it } from "vitest";
import { chunkForEmbedding } from "../../src/semantic/chunk.js";

const first = (text: string, budget: number, locale?: string) =>
  chunkForEmbedding(text, { budget, ...(locale ? { locale } : {}) })[0]!.body;

describe("sentence-end chunk breaks (#655)", () => {
  it("does not cut after an abbreviation followed by lowercase", () => {
    const text = "One two three four five six. Then e.g. the next part goes on and on until the end";
    expect(first(text, 45)).toBe("One two three four five six. ");
  });

  it("does not cut between Fig. and its number", () => {
    const text = "Results were good overall. See Fig. 3 shows the curve and more words follow here";
    expect(first(text, 45)).toBe("Results were good overall. ");
  });

  it("breaks after a question mark", () => {
    const text = "Is it true? Yes it is and more text continues here without stops at all";
    expect(first(text, 20)).toBe("Is it true? ");
  });

  it("segments Russian text with the book's locale", () => {
    const text = "Короткое вступление идёт. Например, т. е. вторая часть идёт дальше и дальше";
    expect(first(text, 50, "ru")).toBe("Короткое вступление идёт. ");
  });

  it("segments Ukrainian text with the book's locale", () => {
    const text = "Перше речення тут. Друге, тобто т. зв. третє йде далі і далі без кінця";
    expect(first(text, 36, "uk")).toBe("Перше речення тут. ");
  });

  it("keeps offsets exact and the chunks tiling the text", () => {
    const text = "Alpha beta. Gamma e.g. delta? Epsilon Fig. 2 zeta! ".repeat(40);
    const chunks = chunkForEmbedding(text, { budget: 60 });
    expect(chunks.length).toBeGreaterThan(10);
    let pos = 0;
    for (const c of chunks) {
      expect(c.charStart).toBe(pos);
      expect(text.slice(c.charStart, c.charEnd)).toBe(c.body);
      pos = c.charEnd;
    }
    expect(pos).toBe(text.length);
  });

  it("still prefers headings, blank lines and newlines over sentence ends", () => {
    const text = "Intro sentence one. Sentence two here.\nNext line text. More words go here now";
    expect(first(text, 60)).toBe("Intro sentence one. Sentence two here.\n");
  });
});
