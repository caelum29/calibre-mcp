import { describe, it, expect } from "vitest";
import { compileUserRegex } from "../../src/tools/user-regex.js";

describe("compileUserRegex", () => {
  it("compiles a plain pattern case-insensitively by default", () => {
    const { regex } = compileUserRegex("o.?reilly");
    expect(regex?.test("O'Reilly")).toBe(true);
  });

  it("accepts a leading PCRE-style (?i) inline flag", () => {
    const { regex, error } = compileUserRegex("(?i)o.?reilly|packt");
    expect(error).toBeUndefined();
    expect(regex?.source).toBe("o.?reilly|packt");
    expect(regex?.test("Packt")).toBe(true);
  });

  it("folds multi-letter and repeated inline flag groups into the flags argument", () => {
    const { regex } = compileUserRegex("(?im)(?s)^a.b$", "");
    expect(regex?.flags.split("").sort().join("")).toBe("ims");
  });

  it("returns an error for an inline flag JS cannot express", () => {
    const { regex, error } = compileUserRegex("(?x) a b");
    expect(regex).toBeUndefined();
    expect(error).toContain("unsupported inline flag");
  });

  it("returns an error for a malformed pattern", () => {
    const { regex, error } = compileUserRegex("(");
    expect(regex).toBeUndefined();
    expect(error).toBeTruthy();
  });
});
