// calibre://book/{id} resource: the id template variable must be a positive integer before any
// Content Server call — a malformed URI is the caller's error, not an HTTP failure.

import { describe, it, expect, vi } from "vitest";
import { parseBookResourceId, readBookResource } from "../../src/resources/book.js";

describe("parseBookResourceId", () => {
  it("accepts a positive integer string", () => {
    expect(parseBookResourceId("42")).toBe(42);
  });

  it("takes the first value when the template variable arrives as an array", () => {
    expect(parseBookResourceId(["7", "8"])).toBe(7);
  });

  it.each(["abc", "", "0", "-3", "1.5", "1e3", "0x10", " 42", "42abc"])("rejects %j", (raw) => {
    expect(() => parseBookResourceId(raw)).toThrow(/positive integer/);
  });

  it("rejects a missing value", () => {
    expect(() => parseBookResourceId(undefined)).toThrow(/positive integer/);
  });
});

describe("readBookResource", () => {
  it("never reaches the source for an invalid id", async () => {
    const getBook = vi.fn();
    await expect(readBookResource({ getBook }, Number.NaN)).rejects.toThrow(/positive integer/);
    expect(getBook).not.toHaveBeenCalled();
  });
});
