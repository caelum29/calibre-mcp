import { describe, it, expect } from "vitest";
import { bookResourceLink, bookResourceUri } from "../../src/tools/resource-link.js";

describe("bookResourceUri", () => {
  it("builds the canonical book uri", () => {
    expect(bookResourceUri(7)).toBe("calibre://book/7");
  });
});

describe("bookResourceLink", () => {
  it("emits a resource_link block with uri and name", () => {
    const link = bookResourceLink({ id: 658, title: "Rust Book", authors: ["Steve"] });
    expect(link).toMatchObject({
      type: "resource_link",
      uri: "calibre://book/658",
      name: "Rust Book",
    });
  });
  it("joins authors and snippet into the description", () => {
    const link = bookResourceLink({ id: 1, title: "T", authors: ["A", "B"], snippet: "hit" });
    expect(link.description).toBe("A, B — hit");
  });
});
