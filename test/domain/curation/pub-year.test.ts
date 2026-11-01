// #347 review: pubYear reads the no-date sentinel via isEmptyDate and still drops implausible
// years (≤ 1000), so a hand-mangled pubdate can't skew the edition-gap check in find_duplicates.
import { describe, expect, it } from "vitest";
import { pubYear } from "../../../src/domain/curation/edition.js";

describe("pubYear (#347)", () => {
  it("should_return_undefined_for_the_sentinel_empty_and_implausible_years", () => {
    const none = ["0101-01-01T00:00:00+00:00", "", undefined, "0999-05-01", "1000-01-01", "0101-12-31", "0000-01-01"];
    expect(none.map(pubYear)).toEqual(none.map(() => undefined));
  });

  it("should_return_the_year_from_the_first_plausible_year_on", () => {
    expect(["1001-01-01", "2020-06-01T00:00:00+00:00"].map(pubYear)).toEqual([1001, 2020]);
  });
});
