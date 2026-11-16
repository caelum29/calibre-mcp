// ftsOverlap takes its tokens from ftsMatch itself (#359 review): the keyword half also ORs the
// query's identifier-like raw tokens (#634: c++, node.js, three-way), so the guard checks them
// against the text's raw tokens too.

import { describe, expect, it } from "vitest";
import { ftsOverlap } from "./leak-guard.js";

describe("ftsOverlap and identifier tokens", () => {
  it("flags a hyphenated raw token shared with the text", () => {
    expect(ftsOverlap("three-way", "a three-way partition")).toContain("three-way");
  });

  it("flags a dotted identifier shared with the text, also at a sentence end", () => {
    expect(ftsOverlap("node.js", "We use Node.js.")).toContain("node.js");
  });

  it("does not flag an identifier the text lacks", () => {
    expect(ftsOverlap("c++", "plain words only")).toEqual([]);
  });
});
