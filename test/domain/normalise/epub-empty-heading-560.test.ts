// #560: an empty ATX heading line ("# ", "###### ") keeps its marker as it is: the trailing-space
// rule must not turn it into a bare "#" (books 395 and 154 have such lines between sections).
import { describe, expect, it } from "vitest";
import { normaliseText, ruleSetsFor } from "../../../src/domain/normalise/normalise.js";

const epub = (raw: string) => normaliseText(raw, ruleSetsFor("ebook-convert")).text;

describe("empty headings (#560)", () => {
  it("keeps the space after an empty heading marker", () => {
    expect(epub("orcid*\n\n# \n\nMartin is")).toBe("orcid*\n\n# \n\nMartin is");
    expect(epub("ownership.\n\n\n###### \n\n\nThe problem")).toBe("ownership.\n\n###### \n\nThe problem");
  });

  it("still strips trailing spaces after a heading's title", () => {
    expect(epub("## Title  \ntext")).toBe("## Title\ntext");
  });
});
