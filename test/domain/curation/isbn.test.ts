import { describe, expect, it } from "vitest";
import { isValidIsbn, isValidIsbn10, isValidIsbn13, normalizeIsbn } from "../../../src/domain/curation/isbn.js";

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
