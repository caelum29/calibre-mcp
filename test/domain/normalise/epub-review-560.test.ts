// #560 review round 1 (PR #717): escaped stars stay literal, backslash runs unescape in pairs,
// fences close only on a matching fence, and no rule goes quadratic on a long line.
import { describe, expect, it } from "vitest";
import { normaliseText, ruleSetsFor } from "../../../src/domain/normalise/normalise.js";

const epub = (raw: string) => normaliseText(raw, ruleSetsFor("ebook-convert")).text;

/** Wall time of one call, in ms. */
function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("escaped emphasis markers stay literal (#560 review)", () => {
  it("keeps escaped single stars as stars", () => {
    expect(epub("\\*literal\\*")).toBe("*literal*");
  });

  it("keeps escaped double stars as stars", () => {
    expect(epub("\\*\\*x\\*\\*")).toBe("**x**");
  });

  it("keeps the stars of an escaped note", () => {
    expect(epub("A \\*Note: foo\\*")).toBe("A *Note: foo*");
  });
});

describe("backslash runs unescape in pairs (#560 review)", () => {
  it("turns an escaped backslash before an escaped paren into one backslash and the paren", () => {
    expect(epub("a \\\\\\( b")).toBe("a \\( b");
  });

  it("turns two escaped backslashes before an escaped paren into two backslashes and the paren", () => {
    expect(epub("a \\\\\\\\\\( b")).toBe("a \\\\( b");
  });
});

describe("fences close only on a matching fence (#560 review)", () => {
  it("does not close a tilde fence on a backtick line", () => {
    const raw = "~~~py\nx\n```\nstill \\(in\\)\n~~~\nout \\(k\\)";
    expect(epub(raw)).toBe("~~~py\nx\n```\nstill \\(in\\)\n~~~\nout (k)");
  });

  it("does not close a four-backtick fence on a three-backtick line", () => {
    const raw = "````md\n```\nin \\(a\\)\n```\n````\nout \\(b\\)";
    expect(epub(raw)).toBe("````md\n```\nin \\(a\\)\n```\n````\nout (b)");
  });
});

describe("no quadratic rule on a long line (#560 review)", () => {
  it("handles a long interior space run in under 500 ms", () => {
    const raw = `x${" ".repeat(50_000)}y`;
    expect(timed(() => epub(raw))).toBeLessThan(500);
  });

  it("handles a 200k-char line of unclosed strong openers in under 500 ms", () => {
    const raw = "**a ".repeat(50_000);
    expect(timed(() => epub(raw))).toBeLessThan(500);
  });

  it("still strips trailing spaces after a long interior run", () => {
    expect(epub(`x${" ".repeat(1000)}y   \nz`)).toBe(`x${" ".repeat(1000)}y\nz`);
  });
});
