// Regression for #445: binary digit groups (0/1 only) in exercise text must not become a bare ISBN-10.
import { describe, expect, it } from "vitest";
import { extractIsbns } from "../../../src/domain/enrich/extract-isbn.js";

describe("extractIsbns — binary digit runs (#445)", () => {
  it("rejects a bare 0/1-only run stitched from spaced nibble groups", () => {
    const text = "Exercise 3-4. Encode the word as 0011 0011 00 and then shift the register left by one position.";
    expect(extractIsbns(text)).toEqual([]);
  });

  it("rejects the same run written without spaces", () => {
    expect(extractIsbns("The output is 0011001100 after two clock cycles.")).toEqual([]);
  });

  it("still accepts a real bare ISBN-10 next to binary groups", () => {
    const text = "Pattern 0011 0011 00 appears here. Published as 0306406152 in print.";
    expect(extractIsbns(text)).toEqual(["0306406152"]);
  });

  it("still accepts a labelled ISBN-10", () => {
    expect(extractIsbns("ISBN 0-306-40615-2")).toEqual(["0306406152"]);
  });
});
