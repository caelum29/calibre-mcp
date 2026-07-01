import { describe, expect, it } from "vitest";
import { stemText, stemToken } from "../../src/semantic/stem.js";

describe("stemText / stemToken", () => {
  it("collapses Russian inflections to a shared stem", () => {
    // The whole point of pre-stemming: unicode61 alone never matches these.
    expect(stemText("книга книги книгу книгами")).toBe("книг книг книг книг");
  });

  it("normalizes ё→е so both spellings share a stem", () => {
    expect(stemToken("ёлки")).toBe(stemToken("елки"));
  });

  it("stems English inflections", () => {
    expect(stemText("running runs runner")).toBe("run run runner");
  });

  it("leaves identifiers with digits or underscores raw (lowercased)", () => {
    expect(stemToken("__init__")).toBe("__init__");
    expect(stemToken("utf8")).toBe("utf8");
    expect(stemToken("v2")).toBe("v2");
  });

  it("leaves camelCase identifiers raw", () => {
    expect(stemToken("ConsumerRebalanceListener")).toBe("consumerrebalancelistener");
  });

  it("drops punctuation and lowercases, keeping token order", () => {
    expect(stemText("Hello, World!")).toBe("hello world");
  });

  it("returns an empty string for text with no word tokens", () => {
    expect(stemText("... !!! ---")).toBe("");
  });
});
