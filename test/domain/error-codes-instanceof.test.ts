// #347: timeout classes are classified by type, not by their `name` string — a subclass (or a
// renamed instance) of a timeout error is still a timeout, never a generic/unreachable error.
import { describe, expect, it } from "vitest";
import { errorCodeFor } from "../../src/domain/error-codes.js";
import { CalibreCliTimeoutError, CalibreHttpTimeoutError } from "../../src/domain/errors.js";

class RoutedWriteTimeoutError extends CalibreCliTimeoutError {
  constructor() {
    super("routed write timed out");
    this.name = "RoutedWriteTimeoutError";
  }
}

class CoverFetchTimeoutError extends CalibreHttpTimeoutError {
  constructor() {
    super("http://localhost:8080/get/cover/1");
    this.name = "CoverFetchTimeoutError";
  }
}

describe("errorCodeFor timeout classes by instanceof (#347)", () => {
  it("should_map_a_cli_timeout_subclass_to_timeout", () => {
    expect(errorCodeFor(new RoutedWriteTimeoutError())).toBe("timeout");
  });

  it("should_map_an_http_timeout_subclass_to_timeout", () => {
    expect(errorCodeFor(new CoverFetchTimeoutError())).toBe("timeout");
  });

  it("should_still_map_the_base_timeout_classes_to_timeout", () => {
    expect([new CalibreCliTimeoutError("t"), new CalibreHttpTimeoutError("u")].map(errorCodeFor)).toEqual([
      "timeout",
      "timeout",
    ]);
  });
});
