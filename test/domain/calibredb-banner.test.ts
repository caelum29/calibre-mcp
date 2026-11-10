// stripCalibredbBanner (#518): drops only the leading banner lines of calibredb stdout.
import { describe, expect, it } from "vitest";
import { stripCalibredbBanner } from "../../src/domain/calibredb-banner.js";

describe("stripCalibredbBanner", () => {
  it("should_drop_leading_banner_lines_only", () => {
    expect(stripCalibredbBanner("Integration status: False\nIntegration status: True\nbody\n")).toBe("body\n");
  });
  it("should_keep_a_banner_line_that_is_not_first", () => {
    expect(stripCalibredbBanner("a\nIntegration status: False\n")).toBe("a\nIntegration status: False\n");
  });
  it("should_return_banner_free_output_unchanged", () => {
    expect(stripCalibredbBanner("  x\n")).toBe("  x\n");
  });
});
