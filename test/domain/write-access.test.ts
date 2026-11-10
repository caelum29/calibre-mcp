// #439: Calibre's answer to the write-access probe (a POST to a write module at a version that
// does not exist) maps to allowed / refused / unknown. Bodies are the ones observed on Calibre 9.18.

import { describe, expect, it } from "vitest";
import { classifyWriteProbe } from "../../src/domain/write-access.js";

describe("classifyWriteProbe", () => {
  it("should_read_a_403_as_refused", () => {
    expect(classifyWriteProbe(403, "Anonymous users are not allowed to make changes")).toEqual({ access: "refused" });
  });

  it("should_read_the_404_unknown_version_as_allowed", () => {
    expect(
      classifyWriteProbe(
        404,
        "The module set_metadata is not available in version: 999. Make sure the version of calibre",
      ),
    ).toEqual({ access: "allowed" });
  });

  it("should_not_guess_on_a_404_with_another_body", () => {
    expect(classifyWriteProbe(404, "Not Found")).toEqual({ access: "unknown", reason: "HTTP 404" });
  });

  it("should_not_guess_on_any_other_status", () => {
    expect([classifyWriteProbe(200, ""), classifyWriteProbe(500, "boom"), classifyWriteProbe(401, "")]).toEqual([
      { access: "unknown", reason: "HTTP 200" },
      { access: "unknown", reason: "HTTP 500" },
      { access: "unknown", reason: "HTTP 401" },
    ]);
  });
});
