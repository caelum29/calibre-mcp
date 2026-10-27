import { describe, it, expect } from "vitest";
import { scanPageStarts } from "../../src/domain/page-offsets.js";

describe("scanPageStarts", () => {
  it("maps each page to the offset after its \\f", () => {
    expect(scanPageStarts("ab\fcd\fe")).toEqual([0, 3, 6]);
  });
  it("is a single page when there are no breaks", () => {
    expect(scanPageStarts("a\nb\nc")).toEqual([0]);
  });
});
