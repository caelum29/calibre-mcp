// #370 review: a write that failed on its FIRST attempt ran no retry, so the steer must not
// say "after 0 retries" — the clause is omitted, while 1 and 2 retries keep their counts.
import { describe, expect, it } from "vitest";
import { describeTransient, withTransientRetry } from "../../src/app/write-policy.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";

const thrownBy = (errors: Error[]) => {
  let n = 0;
  return withTransientRetry(
    async () => {
      throw errors[Math.min(n++, errors.length - 1)];
    },
    async () => {},
  ).then(
    () => undefined,
    (err: unknown) => err,
  );
};

const HTTP503 = () => new CalibreCliError(1, "failed", "HTTP Error 503: Service Unavailable");

describe("describeTransient retry wording (#370)", () => {
  it("should_omit_the_retry_clause_when_the_first_attempt_failed", async () => {
    const err = await thrownBy([new CalibreCliTimeoutError("calibredb command timed out")]);
    expect(describeTransient(err, 1)).toBe(
      "The Calibre Content Server answered HTTP 5xx; it may be restarting — retry shortly.",
    );
  });

  it("should_say_after_1_retry_when_one_retry_ran", async () => {
    const err = await thrownBy([HTTP503(), new CalibreCliTimeoutError("calibredb command timed out")]);
    expect(describeTransient(err, 1)).toBe(
      "The Calibre Content Server answered HTTP 5xx after 1 retry; it may be restarting — retry shortly.",
    );
  });

  it("should_say_after_2_retries_when_every_retry_ran", async () => {
    const err = await thrownBy([HTTP503()]);
    expect(describeTransient(err, 1)).toBe(
      "The Calibre Content Server answered HTTP 503 after 2 retries; it may be restarting — retry shortly.",
    );
  });
});
