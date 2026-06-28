import { describe, it, expect } from "vitest";
import { toLibId } from "../../src/calibre/lib-id.js";

describe("toLibId (offline fallback)", () => {
  it("replaces spaces with underscores", () => {
    expect(toLibId("Programming Books")).toBe("Programming_Books");
  });
});
