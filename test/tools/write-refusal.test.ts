// Classification of calibredb stderr as a Content-Server write refusal (#237).
import { describe, it, expect } from "vitest";
import { isWriteRefused } from "../../src/app/write-policy.js";
import { CalibreCliError } from "../../src/domain/errors.js";

const cliErr = (stderr: string): CalibreCliError => new CalibreCliError(1, "boom", stderr);

describe("isWriteRefused", () => {
  it("should_classify_a_403_forbidden_as_a_refusal", () => {
    expect(isWriteRefused(cliErr("HTTP Error 403: Forbidden"))).toBe(true);
  });

  // observed stderr when the server answers 401 (auth enabled), #233 probe
  it("should_classify_calibredbs_real_401_message_as_a_refusal", () => {
    expect(isWriteRefused(cliErr("A username and password is required to access this server"))).toBe(true);
  });

  it("should_match_the_401_message_case_insensitively", () => {
    expect(isWriteRefused(cliErr("a USERNAME AND PASSWORD IS REQUIRED to access this server"))).toBe(true);
  });

  it("should_not_classify_an_unrelated_failure_as_a_refusal", () => {
    expect(isWriteRefused(cliErr("No book with id: 99999"))).toBe(false);
  });

  it("should_not_classify_a_non_cli_error_as_a_refusal", () => {
    expect(isWriteRefused(new Error("Forbidden"))).toBe(false);
  });
});
