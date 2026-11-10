// Calibre version parsing + comparison (#499, D-029): the version gate for 9.18-only calls.

import { describe, expect, it } from "vitest";
import { isAtLeast, parseCalibreVersion } from "../../src/domain/calibre-version.js";

// Real `calibredb --version` output on the dev machine (2026-11-10), byte-for-byte.
const REAL_9_18 = "Integration status: False\ncalibredb (calibre 9.18)\n";

describe("parseCalibreVersion (#499)", () => {
  it.each([
    [REAL_9_18, "9.18"],
    ["Integration status: False\ncalibredb (calibre 9.11)\n", "9.11"],
    ["calibredb (calibre 10.0)\n", "10.0"],
    ["calibredb (calibre 9.18.1)\n", "9.18.1"],
  ])("should_read_the_version_from_%j", (stdout, text) => {
    const v = parseCalibreVersion(stdout);
    expect(v === "unknown" ? v : v.text).toBe(text);
  });

  it("should_keep_the_numeric_parts_of_a_three_part_version", () => {
    expect(parseCalibreVersion("calibredb (calibre 9.18.1)\n")).toEqual({
      text: "9.18.1",
      major: 9,
      minor: 18,
      patch: 1,
    });
  });

  it.each([[""], ["Integration status: False\n"], ["calibredb (calibre)\n"], ["Usage: calibredb command"]])(
    "should_return_unknown_for_unparseable_output_%j",
    (stdout) => {
      expect(parseCalibreVersion(stdout)).toBe("unknown");
    },
  );
});

describe("isAtLeast (#499)", () => {
  const v = (s: string) => {
    const p = parseCalibreVersion(`calibredb (calibre ${s})`);
    if (p === "unknown") throw new Error(`fixture ${s} did not parse`);
    return p;
  };
  it.each([
    ["9.18", true],
    ["9.18.1", true],
    ["10.0", true],
    ["9.11", false],
    ["9.9", false],
    ["8.99", false],
  ])("should_compare_%s_against_9_18_numerically", (found, ok) => {
    expect(isAtLeast(v(found), "9.18")).toBe(ok);
  });
});
