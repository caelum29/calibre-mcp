import { describe, expect, it } from "vitest";
import { authorSuspectReason, normalizeAuthors, splitAuthorString } from "../../../src/domain/curation/authors.js";

// #201: provider/import author strings arrive as "Last, First" or several people glued into one.
describe("splitAuthorString (#201)", () => {
  it("flips a single 'Last, First' name to 'First Last'", () => {
    expect(splitAuthorString("Graham, Paul")).toEqual(["Paul Graham"]);
  });

  it("keeps initials and particles when flipping", () => {
    expect(splitAuthorString("Martin, Robert C.")).toEqual(["Robert C. Martin"]);
  });

  it("splits a glued list of 'Last, First' names (comma-joined, no spaces)", () => {
    expect(splitAuthorString("Petre, Marian,Hoek, André van der,Quach, Yen")).toEqual([
      "Marian Petre",
      "André van der Hoek",
      "Yen Quach",
    ]);
  });

  it("splits a comma-joined list of 'First Last' names", () => {
    expect(splitAuthorString("Ian Miell, Aidan Hobson Sayers")).toEqual(["Ian Miell", "Aidan Hobson Sayers"]);
  });

  it("leaves a plain 'First Last' name untouched (whitespace collapsed)", () => {
    expect(splitAuthorString("  Paul   Graham ")).toEqual(["Paul Graham"]);
  });

  it("drops a trailing semicolon left by an importer", () => {
    expect(splitAuthorString("PRESSMAN;")).toEqual(["PRESSMAN"]);
  });

  it("returns nothing for an empty or blank string", () => {
    expect(splitAuthorString("   ")).toEqual([]);
  });

  it("ignores a trailing comma", () => {
    expect(splitAuthorString("Graham, Paul,")).toEqual(["Paul Graham"]);
  });

  it("leaves an ambiguous odd mix of forms as-is rather than guessing", () => {
    expect(splitAuthorString("Doe, John, Jane Roe")).toEqual(["Doe, John, Jane Roe"]);
  });
});

describe("normalizeAuthors (#201)", () => {
  it("normalizes every entry and drops case-insensitive duplicates, keeping order", () => {
    expect(normalizeAuthors(["Graham, Paul", "paul graham", "Jez Humble, Joanne Molesky"])).toEqual([
      "Paul Graham",
      "Jez Humble",
      "Joanne Molesky",
    ]);
  });

  it("returns an empty list for an empty input", () => {
    expect(normalizeAuthors([])).toEqual([]);
  });
});

describe("authorSuspectReason (#201)", () => {
  it("flags a comma (glued people or 'Last, First')", () => {
    expect(authorSuspectReason("Jez Humble, Joanne Molesky")).toBe("comma");
  });

  it("flags a value without any letters (a year from the filename)", () => {
    expect(authorSuspectReason("2007")).toBe("no-letters");
  });

  it("flags a semicolon", () => {
    expect(authorSuspectReason("PRESSMAN;")).toBe("semicolon");
  });

  it("accepts an ordinary name, including non-Latin letters and particles", () => {
    expect([authorSuspectReason("André van der Hoek"), authorSuspectReason("Лев Толстой")]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
