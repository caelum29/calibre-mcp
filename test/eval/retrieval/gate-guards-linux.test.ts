// The `thresholds.linux` block is checked as a whole on every platform (#364 review): only the
// declared keys, and `listDiff` only "report", so a typo can't silently turn the Linux rule into
// "no drift entries" or a misspelled list-diff mode into a non-blocking one.

import { describe, expect, it } from "vitest";
import type { Thresholds } from "./gate.js";
import { gateRuleFor } from "./gate-guards.js";

const base = { baselineReport: "reports/on.json", nonRegression: {} };
const withLinux = (linux: unknown) => ({ ...base, linux }) as unknown as Thresholds;

describe.each(["darwin", "linux"])("gateRuleFor on %s rejects a malformed linux block", (platform) => {
  it('listDiff "Report" (wrong case)', () => {
    expect(() => gateRuleFor(platform, withLinux({ listDiff: "Report", platformDrift: [] }))).toThrow(
      'thresholds.linux.listDiff must be "report" (got "Report")',
    );
  });

  it("missing listDiff", () => {
    expect(() => gateRuleFor(platform, withLinux({ platformDrift: [] }))).toThrow(
      'thresholds.linux.listDiff must be "report" (got undefined)',
    );
  });

  it("unknown key platformDrfit", () => {
    expect(() => gateRuleFor(platform, withLinux({ listDiff: "report", platformDrfit: [] }))).toThrow(
      "thresholds.linux has unknown key platformDrfit (allowed: $comment, listDiff, platformDrift)",
    );
  });
});

describe("gateRuleFor accepts the declared shape", () => {
  it("with a $comment, report-only list diff and no entries", () => {
    expect(gateRuleFor("linux", withLinux({ $comment: "x", listDiff: "report", platformDrift: [] }))).toEqual({
      name: "linux",
      listDiffBlocking: false,
      platformDrift: [],
    });
  });
});
