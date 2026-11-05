// Pins the ±1 day pubdate tolerance of the "did it land" check (#390, chosen in #380): Calibre
// stores a date-only pubdate as local midnight and reads it back in UTC, so it may shift one day.

import { describe, expect, it } from "vitest";
import { matchesIntended } from "../../src/domain/book-fields.js";

describe("matchesIntended — pubdate ±1 day (#390)", () => {
  it("should_accept_a_utc_read_back_of_a_local_midnight_east_of_utc", () => {
    // written "2020-05-10" in UTC+2 → stored 2020-05-10T00:00+02:00 → read back as the 9th in UTC
    expect(matchesIntended("pubdate", "2020-05-09T22:00:00+00:00", "2020-05-10")).toBe(true);
  });

  it("should_accept_the_same_day_with_a_time_added", () => {
    expect(matchesIntended("pubdate", "2020-05-10T00:00:00+00:00", "2020-05-10")).toBe(true);
  });

  it("should_accept_the_next_day_too", () => {
    // the tolerance is symmetric: the accepted risk is a concurrent GUI edit to an adjacent day
    expect(matchesIntended("pubdate", "2020-05-11T05:00:00+00:00", "2020-05-10")).toBe(true);
  });

  it("should_reject_a_date_two_days_off", () => {
    expect(matchesIntended("pubdate", "2020-05-08T22:00:00+00:00", "2020-05-10")).toBe(false);
    expect(matchesIntended("pubdate", "2020-05-12T00:00:00+00:00", "2020-05-10")).toBe(false);
  });

  it("should_reject_an_unparsable_read_back", () => {
    expect(matchesIntended("pubdate", "unknown", "2020-05-10")).toBe(false);
    expect(matchesIntended("pubdate", undefined, "2020-05-10")).toBe(false);
  });
});
