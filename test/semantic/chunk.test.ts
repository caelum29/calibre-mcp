import { describe, expect, it } from "vitest";
import { chunkForEmbedding } from "../../src/semantic/chunk.js";

describe("chunkForEmbedding", () => {
  it("returns [] for empty text", () => {
    expect(chunkForEmbedding("")).toEqual([]);
  });

  it("returns one chunk when text fits the budget", () => {
    const text = "Short paragraph that fits.";
    const chunks = chunkForEmbedding(text, { budget: 900 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ body: text, charStart: 0, charEnd: text.length });
  });

  it("offsets are exact positions in the original text", () => {
    const text = "abcdefghij".repeat(50); // 500 chars, no separators
    const chunks = chunkForEmbedding(text, { budget: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(text.slice(c.charStart, c.charEnd)).toBe(c.body);
    }
  });

  it("produces overlapping, forward-moving windows that cover the whole text", () => {
    const text = "word ".repeat(400); // 2000 chars
    const chunks = chunkForEmbedding(text, { budget: 300, overlap: 50 });
    // Monotonic starts, forward progress, overlap present between neighbors.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.charStart).toBeGreaterThan(chunks[i - 1]!.charStart);
      expect(chunks[i]!.charStart).toBeLessThan(chunks[i - 1]!.charEnd); // overlap
    }
    // Coverage: last chunk reaches the end.
    expect(chunks.at(-1)!.charEnd).toBe(text.length);
  });

  it("respects the length budget", () => {
    const text = "x".repeat(2000);
    const chunks = chunkForEmbedding(text, { budget: 250, overlap: 0 });
    for (const c of chunks) expect(c.body.length).toBeLessThanOrEqual(250);
  });

  it("prefers breaking at a paragraph boundary", () => {
    const text = `${"a".repeat(200)}\n\n${"b".repeat(200)}`;
    const chunks = chunkForEmbedding(text, { budget: 260, overlap: 0 });
    // The first chunk should end at (or just after) the blank-line break, not mid-run.
    expect(chunks[0]!.body.endsWith("\n\n")).toBe(true);
  });

  it("does not split a surrogate pair on a hard cut", () => {
    // 400 emoji (each a surrogate pair, 2 code units) → forced hard splits.
    const text = "😀".repeat(400);
    const chunks = chunkForEmbedding(text, { budget: 101, overlap: 0 });
    for (const c of chunks) {
      // A well-formed slice re-encodes without the U+FFFD replacement char.
      expect(c.body).not.toContain("�");
      expect(c.body.length % 2).toBe(0); // whole surrogate pairs only
    }
  });

  it("handles Cyrillic text without corruption", () => {
    const text = "Привет мир, это книга о программировании. ".repeat(30);
    const chunks = chunkForEmbedding(text, { budget: 200, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(text.slice(c.charStart, c.charEnd)).toBe(c.body);
  });
});
