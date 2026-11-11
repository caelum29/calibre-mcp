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

// #551: pdftotext output is hard-wrapped, so a plain "\n" is a line end, not a boundary.
describe("chunkText sentenceAware on hard-wrapped and paged text (#551)", () => {
  // pdftotext shape: ~36-char wrapped lines, a page end ("\n\n\f") mid-sentence.
  const pdf =
    "The model reads each page of a book.\n" +
    "It then splits the text into small\n" +
    "windows, and each window is scored\n" +
    "against the query before it is ranked\n" +
    "with the other windows in the index.\n" +
    "With these new tools at hand we dive\n" +
    "into\n\n\fthe next chapter, which covers the\n" +
    "ranking stage in much more detail.\n";

  it("trims hard-wrapped PDF text to the last sentence end above the floor", () => {
    // Window = first 240 chars (ends inside "the next chapter"); floor = 120. The old
    // cut landed on "dive\ninto\n\n", the page-end blank line (the #551 repro).
    const r = chunkText(pdf, { offset: 0, maxChars: 240, sentenceAware: true });
    expect(r.slice).toBe(
      "The model reads each page of a book.\n" +
        "It then splits the text into small\n" +
        "windows, and each window is scored\n" +
        "against the query before it is ranked\n" +
        "with the other windows in the index.",
    );
    expect(r.end).toBe(181);
  });

  it("does not cut at a single line end or at a page-end blank line", () => {
    // No sentence end above the floor; the "\n\n\f" page end is not a paragraph break,
    // so the full window is kept (the old raw cut).
    const text = "aaaa bbbb\ncccc dddd\neeee\n\n\fffff gggg hhhh";
    const r = chunkText(text, { offset: 0, maxChars: 30, sentenceAware: true });
    expect(r.slice).toBe(text.slice(0, 30));
    expect(r.end).toBe(30);
  });

  it("falls back to a real paragraph break when no sentence end is above the floor", () => {
    const text = "Part one\nIntroduction\n\nThe first section starts here and runs on";
    const r = chunkText(text, { offset: 0, maxChars: 40, sentenceAware: true });
    expect(r.slice).toBe("Part one\nIntroduction\n\n");
    expect(r.end).toBe(23);
  });

  it("never treats a form feed as a boundary", () => {
    const text = "aaaa bbbb cccc\fdddd eeee ffff gggg";
    const r = chunkText(text, { offset: 0, maxChars: 24, sentenceAware: true });
    expect(r.slice).toBe("aaaa bbbb cccc\fdddd eeee");
    expect(r.end).toBe(24);
  });

  it("keeps the old cut (never empty) when the window has no boundary at all", () => {
    const text = "word ".repeat(20);
    const r = chunkText(text, { offset: 0, maxChars: 23, sentenceAware: true });
    expect(r.slice).toBe("word word word word wor");
    expect(r.end).toBe(23);
    expect(r.hasMore).toBe(true);
  });

  it("does not count a period inside a number at the window edge as a sentence end", () => {
    // The window ends at "3." of "3.14"; the next char in the text is a digit, so the cut
    // goes back to the real sentence end at "line.".
    const text = "A short line. Pi is 3.14 and that is enough";
    const r = chunkText(text, { offset: 0, maxChars: 22, sentenceAware: true });
    expect(r.slice).toBe("A short line.");
    expect(r.end).toBe(13);
  });

  it("trims hard-wrapped Cyrillic text to the last sentence end", () => {
    const text =
      "Модель читає кожну сторінку книги.\n" +
      "Потім вона ділить текст на малі\n" +
      "вікна й оцінює кожне з них окремо.\n" +
      "Після цього ми переходимо до\n" +
      "наступного розділу книги";
    const r = chunkText(text, { offset: 0, maxChars: 120, sentenceAware: true });
    expect(r.slice).toBe(
      "Модель читає кожну сторінку книги.\n" +
        "Потім вона ділить текст на малі\n" +
        "вікна й оцінює кожне з них окремо.",
    );
    expect(r.end).toBe(101);
  });

  it("walks the whole text gap-free and overlap-free, from 0 and from an offset", () => {
    for (const from of [0, 57]) {
      let offset = from;
      let joined = "";
      let calls = 0;
      for (;;) {
        const r = chunkText(pdf, { offset, maxChars: 60, sentenceAware: true });
        expect(r.start).toBe(offset);
        expect(r.end).toBe(r.start + r.slice.length);
        expect(r.slice.length).toBeGreaterThan(0);
        joined += r.slice;
        offset = r.end;
        calls++;
        if (!r.hasMore) break;
      }
      expect(joined).toBe(pdf.slice(from));
      expect(calls).toBeGreaterThan(3);
    }
  });
});
