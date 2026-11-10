import { describe, it, expect } from "vitest";
import { bookResourceLink } from "../../src/tools/resource-link.js";
import { bookResourceUri } from "../../src/shared/book-uri.js";

describe("bookResourceUri", () => {
  it("builds the canonical book uri", () => {
    expect(bookResourceUri(7, "My_Books")).toBe("calibre://book/My_Books/7");
  });
});

describe("bookResourceLink", () => {
  it("emits a resource_link block with uri and name", () => {
    const link = bookResourceLink({ id: 658, title: "Rust Book", authors: ["Steve"] }, "My_Books");
    expect(link).toMatchObject({
      type: "resource_link",
      uri: "calibre://book/My_Books/658",
      name: "Rust Book",
    });
  });
  it("joins authors and snippet into the description", () => {
    const link = bookResourceLink({ id: 1, title: "T", authors: ["A", "B"], snippet: "hit" }, "My_Books");
    expect(link.description).toBe("A, B — hit");
  });
});
