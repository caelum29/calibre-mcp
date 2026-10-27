import { describe, expect, it } from "vitest";
import {
  isValidIsbn,
  isValidIsbn10,
  isValidIsbn13,
  normalizeIsbn,
  toIsbn13,
} from "../../../src/domain/curation/isbn.js";

describe("isbn validation", () => {
  it("normalizes hyphens/spaces and upper-cases X", () => {
    expect(normalizeIsbn("0-306-40615-x")).toBe("030640615X");
  });

  it("accepts a valid ISBN-10 (incl. X check digit)", () => {
    expect(isValidIsbn10("0-306-40615-2")).toBe(true);
    expect(isValidIsbn10("155860832X")).toBe(true);
  });

  it("rejects an ISBN-10 with a bad checksum", () => {
    expect(isValidIsbn10("0306406153")).toBe(false);
  });

  it("accepts a valid ISBN-13", () => {
    expect(isValidIsbn13("978-0-306-40615-7")).toBe(true);
  });

  it("rejects an ISBN-13 with a bad checksum", () => {
    expect(isValidIsbn13("9780306406158")).toBe(false);
  });

  it("dispatches on length and rejects other lengths", () => {
    expect(isValidIsbn("0-306-40615-2")).toBe(true);
    expect(isValidIsbn("978-0-306-40615-7")).toBe(true);
    expect(isValidIsbn("12345")).toBe(false);
  });
});

// #201: proposals always carry ISBN-13 so identifiers don't drift between 10/13 forms.
describe("toIsbn13 (#201)", () => {
  it("converts an ISBN-10 to its 978-prefixed ISBN-13 with a recomputed check digit", () => {
    expect(toIsbn13("0596006624")).toBe("9780596006624");
  });

  it("converts a hyphenated ISBN-10 ending in X (check digit becomes 0)", () => {
    expect(toIsbn13("1-55860-832-X")).toBe("9781558608320");
  });

  it("returns an ISBN-13 normalized but otherwise unchanged", () => {
    expect(toIsbn13("978-0-306-40615-7")).toBe("9780306406157");
  });

  it("returns an invalid value normalized but not converted", () => {
    expect(toIsbn13("0-596-00662-5")).toBe("0596006625");
  });
});
