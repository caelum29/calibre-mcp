// #655: the numero sign stays (orchestrator decision under ADR-0033's "keep the meaning" rule; Artem to
// confirm). NFKC would turn "\u2116 5" into "No 5", an English stop word in Russian text.
import { describe, expect, it } from "vitest";
import { CHARACTER_RULES, normaliseText } from "../../../src/domain/normalise/normalise.js";

const clean = (raw: string) => normaliseText(raw, [CHARACTER_RULES]).text;

describe("numero sign (#655)", () => {
  it("keeps \u2116 as it is", () => {
    expect(clean("\u2116 5")).toBe("\u2116 5");
    expect(clean("\u0437\u0430\u043f\u0440\u043e\u0441 \u21161")).toBe("\u0437\u0430\u043f\u0440\u043e\u0441 \u21161");
  });

  it("still folds a ligature next to it", () => {
    expect(clean("\ufb01 \u2116 2")).toBe("fi \u2116 2");
  });
});
